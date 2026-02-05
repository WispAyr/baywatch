/**
 * Baywatch Round-Robin Camera Analyzer
 * Cycles through all configured cameras and analyzes zones
 */

import * as db from './database';
import * as imageProcessor from './image-processor';

interface RoundRobinConfig {
  cameras: string[];
  intervalMs: number;
  go2rtcUrl: string;
  enabled: boolean;
}

interface AnalysisResult {
  camera_id: string;
  zone_id: string;
  zone_name: string;
  count: number;
  blobs: imageProcessor.Blob[];
  alarm: boolean;
  timestamp: Date;
}

let config: RoundRobinConfig = {
  cameras: [],
  intervalMs: 5000, // 5 seconds per camera
  go2rtcUrl: process.env.GO2RTC_URL || 'http://localhost:1984',
  enabled: false
};

let currentIndex = 0;
let intervalHandle: NodeJS.Timeout | null = null;
let onUpdate: ((result: AnalysisResult) => void) | null = null;

/**
 * Fetch frame from go2rtc
 */
async function fetchFrame(cameraId: string): Promise<Buffer> {
  const url = `${config.go2rtcUrl}/api/frame.jpeg?src=${cameraId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch frame from ${cameraId}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Analyze a single camera
 */
async function analyzeCamera(cameraId: string): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];
  
  try {
    // Get zones for this camera
    const allZones = db.getAllZones();
    const zones = allZones.filter(z => z.camera_id === cameraId);
    
    if (zones.length === 0) {
      return results;
    }
    
    // Fetch current frame
    const frameBuffer = await fetchFrame(cameraId);
    const backgroundFrame = db.getBackgroundFrame(cameraId);
    
    // Analyze each zone
    for (const zone of zones) {
      const analysis = await imageProcessor.analyzeFrame(
        frameBuffer,
        backgroundFrame,
        zone.polygon,
        {
          minBlobArea: zone.min_blob_area,
          maxBlobArea: zone.max_blob_area
        }
      );
      
      const result: AnalysisResult = {
        camera_id: cameraId,
        zone_id: zone.id,
        zone_name: zone.name,
        count: analysis.count,
        blobs: analysis.blobs,
        alarm: analysis.count >= zone.alarm_threshold,
        timestamp: new Date()
      };
      
      // Log to database
      db.logOccupancy(zone.id, analysis.count, analysis.blobs);
      
      // Notify callback
      if (onUpdate) {
        onUpdate(result);
      }
      
      results.push(result);
    }
  } catch (error) {
    console.error(`[RoundRobin] Error analyzing camera ${cameraId}:`, error);
  }
  
  return results;
}

/**
 * Process next camera in rotation
 */
async function processNext(): Promise<void> {
  if (!config.enabled || config.cameras.length === 0) {
    return;
  }
  
  const cameraId = config.cameras[currentIndex];
  console.log(`[RoundRobin] Analyzing camera ${currentIndex + 1}/${config.cameras.length}: ${cameraId}`);
  
  await analyzeCamera(cameraId);
  
  // Move to next camera
  currentIndex = (currentIndex + 1) % config.cameras.length;
}

/**
 * Start round-robin analysis
 */
export function start(cameras: string[], intervalMs: number = 5000): void {
  config.cameras = cameras;
  config.intervalMs = intervalMs;
  config.enabled = true;
  currentIndex = 0;
  
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
  
  console.log(`[RoundRobin] Starting with ${cameras.length} cameras, ${intervalMs}ms interval`);
  console.log(`[RoundRobin] Cameras: ${cameras.join(', ')}`);
  
  // Run immediately
  processNext();
  
  // Then on interval
  intervalHandle = setInterval(processNext, intervalMs);
}

/**
 * Stop round-robin analysis
 */
export function stop(): void {
  config.enabled = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[RoundRobin] Stopped');
}

/**
 * Set callback for updates
 */
export function setUpdateCallback(callback: (result: AnalysisResult) => void): void {
  onUpdate = callback;
}

/**
 * Get current status
 */
export function getStatus(): { enabled: boolean; cameras: string[]; currentCamera: string | null; intervalMs: number } {
  return {
    enabled: config.enabled,
    cameras: config.cameras,
    currentCamera: config.enabled && config.cameras.length > 0 ? config.cameras[currentIndex] : null,
    intervalMs: config.intervalMs
  };
}

/**
 * Update configuration
 */
export function updateConfig(newConfig: Partial<RoundRobinConfig>): void {
  if (newConfig.cameras) config.cameras = newConfig.cameras;
  if (newConfig.intervalMs) config.intervalMs = newConfig.intervalMs;
  if (newConfig.go2rtcUrl) config.go2rtcUrl = newConfig.go2rtcUrl;
  
  // Restart if running
  if (config.enabled) {
    stop();
    start(config.cameras, config.intervalMs);
  }
}

/**
 * Auto-discover cameras from go2rtc
 */
export async function discoverCameras(): Promise<string[]> {
  try {
    const response = await fetch(`${config.go2rtcUrl}/api/streams`);
    if (!response.ok) {
      throw new Error(`Failed to fetch streams: ${response.status}`);
    }
    const streams = await response.json() as Record<string, unknown>;
    return Object.keys(streams);
  } catch (error) {
    console.error('[RoundRobin] Failed to discover cameras:', error);
    return [];
  }
}

export { AnalysisResult, RoundRobinConfig };
