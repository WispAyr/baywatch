import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import * as db from './database';
import * as imageProcessor from './image-processor';

const PORT = process.env.PORT || 3620;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'zone-occupancy', timestamp: new Date().toISOString() });
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
      
      const analysis = await imageProcessor.analyzeFrame(
        imageBuffer,
        backgroundFrame,
        zone.polygon,
        {
          minBlobArea: zone.min_blob_area,
          maxBlobArea: zone.max_blob_area
        }
      );
      
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
      
      const analysis = await imageProcessor.analyzeFrame(
        imageBuffer,
        backgroundFrame,
        zone.polygon,
        {
          minBlobArea: zone.min_blob_area,
          maxBlobArea: zone.max_blob_area
        }
      );
      
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

// Start server
server.listen(PORT, () => {
  console.log(`🎯 Zone Occupancy Counter running on port ${PORT}`);
  console.log(`   REST API: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
