/**
 * Baywatch Detection Modes
 * Pluggable detection backends for zone occupancy analysis
 */

import * as imageProcessor from './image-processor';

export type DetectionMode = 'blob' | 'hailo-yolo' | 'hailo-ssd';

export interface Detection {
  class: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface DetectionResult {
  detections: Detection[];
  count: number;
  inferenceTimeMs: number;
  mode: DetectionMode;
}

// Current detection mode (default to hailo-yolo when available)
let currentMode: DetectionMode = 'hailo-yolo';

// Hailo ops server URL (running on same Pi)
const HAILO_OPS_URL = process.env.HAILO_OPS_URL || 'http://localhost:3000';

/**
 * Get current detection mode
 */
export function getMode(): DetectionMode {
  return currentMode;
}

/**
 * Set detection mode
 */
export function setMode(mode: DetectionMode): void {
  currentMode = mode;
  console.log(`[DetectionModes] Switched to mode: ${mode}`);
}

/**
 * Get available detection modes
 */
export function getAvailableModes(): { mode: DetectionMode; name: string; description: string }[] {
  return [
    {
      mode: 'blob',
      name: 'Blob Detection',
      description: 'Background subtraction with blob analysis. Fast, no AI required. Works best with static backgrounds.'
    },
    {
      mode: 'hailo-yolo',
      name: 'Hailo YOLO',
      description: 'YOLOv5/v8 object detection on Hailo AI accelerator. Detects vehicles, people, etc.'
    },
    {
      mode: 'hailo-ssd',
      name: 'Hailo SSD',
      description: 'MobileNet SSD detection on Hailo. Faster but less accurate than YOLO.'
    }
  ];
}

/**
 * Run detection on a frame using current mode
 */
export async function detectInFrame(
  frameBuffer: Buffer,
  backgroundBuffer: Buffer | null,
  polygon: { x: number; y: number }[],
  options: {
    minBlobArea?: number;
    maxBlobArea?: number;
    confidenceThreshold?: number;
    classes?: string[];
  } = {}
): Promise<DetectionResult> {
  const startTime = Date.now();

  switch (currentMode) {
    case 'blob':
      return await detectBlob(frameBuffer, backgroundBuffer, polygon, options);
    
    case 'hailo-yolo':
      return await detectHailo(frameBuffer, polygon, 'yolov5', options);
    
    case 'hailo-ssd':
      return await detectHailo(frameBuffer, polygon, 'ssd', options);
    
    default:
      throw new Error(`Unknown detection mode: ${currentMode}`);
  }
}

/**
 * Blob detection using background subtraction
 */
async function detectBlob(
  frameBuffer: Buffer,
  backgroundBuffer: Buffer | null,
  polygon: { x: number; y: number }[],
  options: {
    minBlobArea?: number;
    maxBlobArea?: number;
  }
): Promise<DetectionResult> {
  const startTime = Date.now();
  
  const analysis = await imageProcessor.analyzeFrame(
    frameBuffer,
    backgroundBuffer,
    polygon,
    {
      minBlobArea: options.minBlobArea || 500,
      maxBlobArea: options.maxBlobArea || 50000
    }
  );

  // Convert blobs to detection format
  const detections: Detection[] = analysis.blobs.map(blob => ({
    class: 'object',
    confidence: 1.0, // Blob detection doesn't have confidence
    bbox: blob.boundingBox
  }));

  return {
    detections,
    count: analysis.count,
    inferenceTimeMs: Date.now() - startTime,
    mode: 'blob'
  };
}

/**
 * Hailo AI detection via halio-ops API
 */
async function detectHailo(
  frameBuffer: Buffer,
  polygon: { x: number; y: number }[],
  modelType: 'yolov5' | 'ssd',
  options: {
    confidenceThreshold?: number;
    classes?: string[];
  }
): Promise<DetectionResult> {
  const startTime = Date.now();
  
  try {
    // Convert frame to base64
    const base64Image = frameBuffer.toString('base64');
    
    // Call halio-ops analyze endpoint
    const response = await fetch(`${HAILO_OPS_URL}/analyze/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        model: modelType === 'yolov5' ? 'yolov5m_vehicles' : 'ssd_mobilenet_v2'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Hailo ops error: ${response.status} - ${errText}`);
    }

    const result = await response.json() as {
      detections?: { label: string; confidence: number; bbox?: number[] }[];
      objects?: { label: string; confidence: number; bbox?: { x: number; y: number; width: number; height: number } }[];
      inferenceMs?: number;
      error?: string;
    };

    if (result.error) {
      throw new Error(result.error);
    }

    // Normalize detection format (halio-ops may use different formats)
    const rawDetections = result.detections || result.objects || [];
    const detections: Detection[] = rawDetections.map(det => {
      let bbox = { x: 0, y: 0, width: 0, height: 0 };
      if (det.bbox) {
        if (Array.isArray(det.bbox)) {
          // [x, y, width, height] format
          bbox = { x: det.bbox[0], y: det.bbox[1], width: det.bbox[2], height: det.bbox[3] };
        } else {
          bbox = det.bbox as { x: number; y: number; width: number; height: number };
        }
      }
      return {
        class: det.label || 'object',
        confidence: det.confidence || 0,
        bbox
      };
    });

    // Filter detections by polygon (only keep detections whose center is inside the zone)
    const filteredDetections = detections.filter(det => {
      const centerX = det.bbox.x + det.bbox.width / 2;
      const centerY = det.bbox.y + det.bbox.height / 2;
      return imageProcessor.isPointInPolygon({ x: centerX, y: centerY }, polygon);
    });

    // Filter by class if specified (common classes: car, truck, person, motorcycle)
    const classFiltered = options.classes?.length
      ? filteredDetections.filter(d => options.classes!.includes(d.class))
      : filteredDetections;

    // Filter by confidence
    const confFiltered = classFiltered.filter(
      d => d.confidence >= (options.confidenceThreshold || 0.5)
    );

    return {
      detections: confFiltered,
      count: confFiltered.length,
      inferenceTimeMs: result.inferenceMs || (Date.now() - startTime),
      mode: modelType === 'yolov5' ? 'hailo-yolo' : 'hailo-ssd'
    };
  } catch (error: any) {
    console.error(`[Hailo] Detection error: ${error.message}`);
    
    // Fallback to blob detection if Hailo fails
    console.log('[Hailo] Falling back to blob detection');
    return await detectBlob(frameBuffer, null, polygon, {
      minBlobArea: 500,
      maxBlobArea: 50000
    });
  }
}

/**
 * Check if Hailo is available
 */
export async function checkHailoAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${HAILO_OPS_URL}/halio/status`, { 
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) return false;
    const data = await response.json() as { available: boolean };
    return data.available === true;
  } catch {
    return false;
  }
}
