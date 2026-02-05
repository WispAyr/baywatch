import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import sharp from 'sharp';
import * as db from './database';
import * as imageProcessor from './image-processor';
import * as roundRobin from './round-robin';
import * as detectionModes from './detection-modes';

const PORT = process.env.PORT || 3620;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve dashboard static files
const dashboardPath = path.join(__dirname, '..', 'dashboard');
app.use('/ui', express.static(dashboardPath));
// Also serve assets from root for Vite's default paths
app.use('/assets', express.static(path.join(dashboardPath, 'assets')));
app.use('/vite.svg', express.static(path.join(dashboardPath, 'vite.svg')));

// Store current occupancy counts in memory for fast access
const currentOccupancy: Map<string, { count: number; blobs: imageProcessor.Blob[]; timestamp: Date }> = new Map();

// WebSocket clients
const clients: Set<WebSocket> = new Set();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'image/*', limit: '50mb' }));

// Broadcast to all WebSocket clients
function broadcast(message: object) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Root - redirect to dashboard
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/ui/');
});

// API info
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    service: 'Baywatch',
    version: '1.0.0',
    description: 'Parking Bay Monitor - Zone Occupancy Detection',
    dashboard: '/ui/',
    endpoints: {
      health: 'GET /health',
      zones: 'GET /zones | POST /zones | GET /zones/:id | PATCH /zones/:id | DELETE /zones/:id',
      occupancy: 'GET /occupancy | GET /zones/:id/count | GET /zones/:id/history',
      analyze: 'POST /analyze | POST /analyze-stream',
      cameras: 'GET /cameras',
      roundRobin: 'GET /round-robin/status | POST /round-robin/start | POST /round-robin/stop',
      background: 'POST /background | POST /backgrounds/capture-all',
      detection: 'GET /detection/modes | GET /detection/mode | POST /detection/mode'
    }
  });
});

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  const hailoAvailable = await detectionModes.checkHailoAvailable();
  res.json({ 
    status: 'ok', 
    service: 'zone-occupancy', 
    timestamp: new Date().toISOString(),
    detectionMode: detectionModes.getMode(),
    hailoAvailable
  });
});

// ============ DETECTION MODE ENDPOINTS ============

// Get available detection modes
app.get('/detection/modes', async (_req: Request, res: Response) => {
  const modes = detectionModes.getAvailableModes();
  const currentMode = detectionModes.getMode();
  const hailoAvailable = await detectionModes.checkHailoAvailable();
  
  res.json({
    currentMode,
    hailoAvailable,
    modes: modes.map(m => ({
      ...m,
      active: m.mode === currentMode,
      available: m.mode === 'blob' || hailoAvailable
    }))
  });
});

// Get current detection mode
app.get('/detection/mode', (_req: Request, res: Response) => {
  res.json({ mode: detectionModes.getMode() });
});

// Set detection mode
app.post('/detection/mode', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    
    if (!mode) {
      res.status(400).json({ error: 'Mode is required' });
      return;
    }
    
    const validModes = ['blob', 'hailo-yolo', 'hailo-ssd'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
      return;
    }
    
    // Check if Hailo is available for Hailo modes
    if (mode.startsWith('hailo-')) {
      const hailoAvailable = await detectionModes.checkHailoAvailable();
      if (!hailoAvailable) {
        res.status(400).json({ error: 'Hailo AI accelerator is not available' });
        return;
      }
    }
    
    detectionModes.setMode(mode as detectionModes.DetectionMode);
    
    // Broadcast mode change to WebSocket clients
    broadcast({ type: 'mode_changed', mode });
    
    res.json({ success: true, mode });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ZONE ENDPOINTS ============

// Create zone
app.post('/zones', (req: Request, res: Response) => {
  try {
    const { name, camera_id, polygon, min_blob_area, max_blob_area, alarm_threshold } = req.body;
    
    if (!name || !polygon || !Array.isArray(polygon) || polygon.length < 3) {
      res.status(400).json({ error: 'Name and polygon (min 3 points) are required' });
      return;
    }
    
    // Validate polygon points
    for (const point of polygon) {
      if (typeof point.x !== 'number' || typeof point.y !== 'number') {
        res.status(400).json({ error: 'Invalid polygon point format. Expected {x: number, y: number}' });
        return;
      }
    }
    
    const id = uuidv4();
    const zone = db.createZone(id, {
      name,
      camera_id,
      polygon,
      min_blob_area,
      max_blob_area,
      alarm_threshold
    });
    
    broadcast({ type: 'zone_created', zone });
    res.status(201).json(zone);
  } catch (error: any) {
    console.error('Error creating zone:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all zones
app.get('/zones', (_req: Request, res: Response) => {
  try {
    const zones = db.getAllZones();
    res.json(zones);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single zone
app.get('/zones/:id', (req: Request, res: Response) => {
  try {
    const zoneId = req.params.id as string;
    const zone = db.getZone(zoneId);
    if (!zone) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    res.json(zone);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update zone
app.patch('/zones/:id', (req: Request, res: Response) => {
  try {
    const zoneId = req.params.id as string;
    const zone = db.updateZone(zoneId, req.body);
    if (!zone) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    broadcast({ type: 'zone_updated', zone });
    res.json(zone);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete zone
app.delete('/zones/:id', (req: Request, res: Response) => {
  try {
    const zoneId = req.params.id as string;
    const deleted = db.deleteZone(zoneId);
    if (!deleted) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    currentOccupancy.delete(zoneId);
    broadcast({ type: 'zone_deleted', zoneId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get zone occupancy count
app.get('/zones/:id/count', (req: Request, res: Response) => {
  try {
    const zoneId = req.params.id as string;
    const zone = db.getZone(zoneId);
    if (!zone) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    
    const occupancy = currentOccupancy.get(zoneId);
    res.json({
      zone_id: zoneId,
      zone_name: zone.name,
      count: occupancy?.count ?? 0,
      blobs: occupancy?.blobs ?? [],
      last_updated: occupancy?.timestamp ?? null,
      alarm: (occupancy?.count ?? 0) >= zone.alarm_threshold
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get zone occupancy history
app.get('/zones/:id/history', (req: Request, res: Response) => {
  try {
    const zoneId = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 100;
    const history = db.getRecentOccupancy(zoneId, limit);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYSIS ENDPOINTS ============

// Analyze frame for all zones or specific zones
app.post('/analyze', async (req: Request, res: Response) => {
  try {
    let imageBuffer: Buffer;
    let zoneIds: string[] | undefined;
    let cameraId: string | undefined;
    
    // Handle both JSON (base64) and raw image data
    if (req.is('application/json')) {
      const { image, zone_ids, camera_id: camId } = req.body;
      if (!image) {
        res.status(400).json({ error: 'Image data required (base64)' });
        return;
      }
      imageBuffer = Buffer.from(image, 'base64');
      zoneIds = zone_ids;
      cameraId = camId;
    } else {
      imageBuffer = req.body as Buffer;
      zoneIds = req.query.zone_ids ? (req.query.zone_ids as string).split(',') : undefined;
      cameraId = req.query.camera_id as string;
    }
    
    // Get zones to analyze
    let zones = db.getAllZones();
    if (zoneIds) {
      zones = zones.filter(z => zoneIds!.includes(z.id));
    }
    if (cameraId) {
      zones = zones.filter(z => z.camera_id === cameraId || !z.camera_id);
    }
    
    if (zones.length === 0) {
      res.status(400).json({ error: 'No zones to analyze' });
      return;
    }
    
    const results: any[] = [];
    
    for (const zone of zones) {
      // Get background for this camera/zone
      const bgKey = zone.camera_id || 'default';
      const backgroundFrame = db.getBackgroundFrame(bgKey);
      
      // Use detection mode (YOLO with vehicle filtering, or blob fallback)
      const mode = detectionModes.getMode();
      let analysis: { blobs: imageProcessor.Blob[]; count: number };
      
      if (mode === 'blob') {
        analysis = await imageProcessor.analyzeFrame(
          imageBuffer,
          backgroundFrame,
          zone.polygon,
          {
            minBlobArea: zone.min_blob_area,
            maxBlobArea: zone.max_blob_area
          }
        );
      } else {
        // Use Hailo YOLO/SSD with vehicle-only filtering
        const result = await detectionModes.detectInFrame(
          imageBuffer,
          backgroundFrame,
          zone.polygon,
          {
            minBlobArea: zone.min_blob_area,
            maxBlobArea: zone.max_blob_area,
            confidenceThreshold: 0.5,
            classes: ['car', 'truck', 'bus', 'motorcycle', 'van', 'vehicle']
          }
        );
        // Convert to blob format for compatibility
        analysis = {
          blobs: result.detections.map((d, i) => ({
            id: i + 1,
            area: d.bbox.width * d.bbox.height,
            centroid: { 
              x: Math.round(d.bbox.x + d.bbox.width / 2), 
              y: Math.round(d.bbox.y + d.bbox.height / 2) 
            },
            boundingBox: d.bbox
          })),
          count: result.count
        };
      }
      
      // Update current occupancy
      currentOccupancy.set(zone.id, {
        count: analysis.count,
        blobs: analysis.blobs,
        timestamp: new Date()
      });
      
      // Log to database
      db.logOccupancy(zone.id, analysis.count, analysis.blobs);
      
      const result = {
        zone_id: zone.id,
        zone_name: zone.name,
        count: analysis.count,
        blobs: analysis.blobs,
        alarm: analysis.count >= zone.alarm_threshold
      };
      
      results.push(result);
      
      // Broadcast update
      broadcast({
        type: 'occupancy_update',
        ...result,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ results });
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set/update background frame for a camera
app.post('/background', async (req: Request, res: Response) => {
  try {
    let imageBuffer: Buffer;
    let cameraId: string;
    
    if (req.is('application/json')) {
      const { image, camera_id } = req.body;
      if (!image || !camera_id) {
        res.status(400).json({ error: 'Image (base64) and camera_id required' });
        return;
      }
      imageBuffer = Buffer.from(image, 'base64');
      cameraId = camera_id;
    } else {
      imageBuffer = req.body as Buffer;
      cameraId = req.query.camera_id as string;
      if (!cameraId) {
        res.status(400).json({ error: 'camera_id query param required' });
        return;
      }
    }
    
    // Update background using running average
    const existingBg = db.getBackgroundFrame(cameraId);
    const newBackground = await imageProcessor.updateBackground(imageBuffer, existingBg);
    
    db.saveBackgroundFrame(cameraId, newBackground);
    
    res.json({ success: true, camera_id: cameraId, message: 'Background updated' });
  } catch (error: any) {
    console.error('Background update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all current occupancy counts
app.get('/occupancy', (_req: Request, res: Response) => {
  const results: any[] = [];
  const zones = db.getAllZones();
  
  for (const zone of zones) {
    const occupancy = currentOccupancy.get(zone.id);
    results.push({
      zone_id: zone.id,
      zone_name: zone.name,
      camera_id: zone.camera_id,
      count: occupancy?.count ?? 0,
      blobs: occupancy?.blobs ?? [],
      last_updated: occupancy?.timestamp ?? null,
      alarm: (occupancy?.count ?? 0) >= zone.alarm_threshold
    });
  }
  
  res.json(results);
});

// ============ UTILITY ENDPOINTS ============

// Fetch frame from go2rtc and analyze
app.post('/analyze-stream', async (req: Request, res: Response) => {
  try {
    const { stream_url, camera_id, zone_ids } = req.body;
    
    if (!stream_url) {
      res.status(400).json({ error: 'stream_url required' });
      return;
    }
    
    // Fetch snapshot from go2rtc
    const response = await fetch(stream_url);
    if (!response.ok) {
      res.status(400).json({ error: `Failed to fetch stream: ${response.status}` });
      return;
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    
    // Get zones to analyze
    let zones = db.getAllZones();
    if (zone_ids) {
      zones = zones.filter(z => zone_ids.includes(z.id));
    }
    if (camera_id) {
      zones = zones.filter(z => z.camera_id === camera_id || !z.camera_id);
    }
    
    const results: any[] = [];
    
    for (const zone of zones) {
      const bgKey = zone.camera_id || camera_id || 'default';
      const backgroundFrame = db.getBackgroundFrame(bgKey);
      
      // Use detection mode (YOLO with vehicle filtering, or blob fallback)
      const mode = detectionModes.getMode();
      let analysis: { blobs: imageProcessor.Blob[]; count: number };
      
      if (mode === 'blob') {
        analysis = await imageProcessor.analyzeFrame(
          imageBuffer,
          backgroundFrame,
          zone.polygon,
          {
            minBlobArea: zone.min_blob_area,
            maxBlobArea: zone.max_blob_area
          }
        );
      } else {
        // Use Hailo YOLO/SSD with vehicle-only filtering
        const result = await detectionModes.detectInFrame(
          imageBuffer,
          backgroundFrame,
          zone.polygon,
          {
            minBlobArea: zone.min_blob_area,
            maxBlobArea: zone.max_blob_area,
            confidenceThreshold: 0.5,
            classes: ['car', 'truck', 'bus', 'motorcycle', 'van', 'vehicle']
          }
        );
        analysis = {
          blobs: result.detections.map((d, i) => ({
            id: i + 1,
            area: d.bbox.width * d.bbox.height,
            centroid: { 
              x: Math.round(d.bbox.x + d.bbox.width / 2), 
              y: Math.round(d.bbox.y + d.bbox.height / 2) 
            },
            boundingBox: d.bbox
          })),
          count: result.count
        };
      }
      
      currentOccupancy.set(zone.id, {
        count: analysis.count,
        blobs: analysis.blobs,
        timestamp: new Date()
      });
      
      db.logOccupancy(zone.id, analysis.count, analysis.blobs);
      
      const result = {
        zone_id: zone.id,
        zone_name: zone.name,
        count: analysis.count,
        blobs: analysis.blobs,
        alarm: analysis.count >= zone.alarm_threshold
      };
      
      results.push(result);
      
      broadcast({
        type: 'occupancy_update',
        ...result,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ results });
  } catch (error: any) {
    console.error('Stream analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ANNOTATED FRAME ENDPOINT ============

// Get latest frame with detection overlays
app.get('/frame/:camera_id', async (req: Request, res: Response) => {
  try {
    const cameraId = req.params.camera_id;
    const go2rtcUrl = process.env.GO2RTC_URL || 'http://localhost:1984';
    
    // Fetch frame from go2rtc
    const response = await fetch(`${go2rtcUrl}/api/frame.jpeg?src=${cameraId}`);
    if (!response.ok) {
      res.status(400).json({ error: `Failed to fetch frame: ${response.status}` });
      return;
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const { width, height } = await sharp(imageBuffer).metadata() as { width: number; height: number };
    
    // Get zones for this camera
    const zones = db.getAllZones().filter(z => z.camera_id === cameraId || !z.camera_id);
    
    // Build SVG overlay with zones and detections
    let svg = `<svg width="${width}" height="${height}">`;
    
    for (const zone of zones) {
      const occupancy = currentOccupancy.get(zone.id);
      const isAlarm = (occupancy?.count ?? 0) >= zone.alarm_threshold;
      const zoneColor = isAlarm ? 'rgba(255,0,0,0.5)' : 'rgba(0,255,0,0.3)';
      
      // Draw zone polygon
      const points = zone.polygon.map(p => `${p.x},${p.y}`).join(' ');
      svg += `<polygon points="${points}" fill="${zoneColor}" stroke="${isAlarm ? '#ff0000' : '#00ff00'}" stroke-width="2"/>`;
      
      // Draw zone label
      if (zone.polygon.length > 0) {
        const labelX = zone.polygon[0].x + 5;
        const labelY = zone.polygon[0].y + 20;
        svg += `<text x="${labelX}" y="${labelY}" fill="white" font-size="14" font-weight="bold" style="text-shadow: 1px 1px 2px black;">${zone.name}: ${occupancy?.count ?? 0}</text>`;
      }
      
      // Draw bounding boxes for detected blobs
      if (occupancy?.blobs) {
        for (const blob of occupancy.blobs) {
          const { x, y, width: w, height: h } = blob.boundingBox;
          svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffff00" stroke-width="2"/>`;
          svg += `<circle cx="${blob.centroid.x}" cy="${blob.centroid.y}" r="4" fill="#ff0000"/>`;
        }
      }
    }
    
    svg += '</svg>';
    
    // If no zones, just return the original image
    if (zones.length === 0) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-cache');
      res.send(imageBuffer);
      return;
    }
    
    // Convert SVG to PNG buffer first, then composite
    const svgBuffer = Buffer.from(svg);
    const overlayPng = await sharp(svgBuffer)
      .png()
      .toBuffer();
    
    // Composite overlay onto image
    const annotatedImage = await sharp(imageBuffer)
      .composite([{
        input: overlayPng,
        top: 0,
        left: 0
      }])
      .jpeg({ quality: 85 })
      .toBuffer();
    
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(annotatedImage);
  } catch (error: any) {
    console.error('Frame error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WEBSOCKET ============

wss.on('connection', (ws: WebSocket) => {
  console.log('WebSocket client connected');
  clients.add(ws);
  
  // Send current state
  const zones = db.getAllZones();
  const state = zones.map(zone => {
    const occupancy = currentOccupancy.get(zone.id);
    return {
      zone_id: zone.id,
      zone_name: zone.name,
      count: occupancy?.count ?? 0,
      last_updated: occupancy?.timestamp ?? null
    };
  });
  
  ws.send(JSON.stringify({ type: 'initial_state', zones: state }));
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// ============ ROUND-ROBIN ENDPOINTS ============

// Start round-robin analysis
app.post('/round-robin/start', async (req: Request, res: Response) => {
  try {
    let { cameras, interval_ms } = req.body;
    
    // Auto-discover if no cameras specified
    if (!cameras || cameras.length === 0) {
      cameras = await roundRobin.discoverCameras();
    }
    
    if (cameras.length === 0) {
      res.status(400).json({ error: 'No cameras available' });
      return;
    }
    
    // Set up broadcast on updates
    roundRobin.setUpdateCallback((result) => {
      // Get previous count for event logging
      const prevOccupancy = currentOccupancy.get(result.zone_id);
      const prevCount = prevOccupancy?.count ?? 0;
      
      currentOccupancy.set(result.zone_id, {
        count: result.count,
        blobs: result.blobs,
        timestamp: result.timestamp
      });
      
      // Log parking event if count changed
      if (prevCount !== result.count) {
        const event = db.logParkingEvent(
          result.zone_id,
          result.zone_name,
          result.camera_id || '',
          prevCount,
          result.count
        );
        
        if (event) {
          broadcast({
            type: 'parking_event',
            event
          });
        }
      }
      
      broadcast({
        type: 'occupancy_update',
        zone_id: result.zone_id,
        zone_name: result.zone_name,
        camera_id: result.camera_id,
        count: result.count,
        alarm: result.alarm,
        timestamp: result.timestamp.toISOString()
      });
    });
    
    roundRobin.start(cameras, interval_ms || 5000);
    
    res.json({ 
      success: true, 
      message: `Round-robin started with ${cameras.length} cameras`,
      cameras,
      interval_ms: interval_ms || 5000
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop round-robin
app.post('/round-robin/stop', (_req: Request, res: Response) => {
  roundRobin.stop();
  res.json({ success: true, message: 'Round-robin stopped' });
});

// Get round-robin status
app.get('/round-robin/status', (_req: Request, res: Response) => {
  res.json(roundRobin.getStatus());
});

// ============ PARKING EVENTS ENDPOINTS ============

// Get parking events log
app.get('/events', (req: Request, res: Response) => {
  try {
    const { limit, offset, zone_id, camera_id, event_type, since, until } = req.query;
    
    const result = db.getParkingEvents({
      limit: limit ? parseInt(limit as string) : 100,
      offset: offset ? parseInt(offset as string) : 0,
      zoneId: zone_id as string,
      cameraId: camera_id as string,
      eventType: event_type as string,
      since: since as string,
      until: until as string
    });
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get parking statistics
app.get('/events/stats', (req: Request, res: Response) => {
  try {
    const { since } = req.query;
    const stats = db.getParkingStats(since as string);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Discover available cameras
app.get('/cameras', async (_req: Request, res: Response) => {
  try {
    const cameras = await roundRobin.discoverCameras();
    res.json({ cameras });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Capture backgrounds for all cameras (for 3am cron)
app.post('/backgrounds/capture-all', async (_req: Request, res: Response) => {
  try {
    const cameras = await roundRobin.discoverCameras();
    const results: { camera_id: string; success: boolean; error?: string }[] = [];
    
    for (const cameraId of cameras) {
      try {
        const response = await fetch(`http://localhost:1984/api/frame.jpeg?src=${cameraId}`);
        if (!response.ok) {
          results.push({ camera_id: cameraId, success: false, error: `HTTP ${response.status}` });
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        db.saveBackgroundFrame(cameraId, buffer);
        results.push({ camera_id: cameraId, success: true });
      } catch (err: any) {
        results.push({ camera_id: cameraId, success: false, error: err.message });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    res.json({ 
      message: `Captured backgrounds for ${successful}/${cameras.length} cameras`,
      results 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`🏖️ Baywatch - Parking Bay Monitor running on port ${PORT}`);
  console.log(`   REST API: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
