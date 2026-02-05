import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'data', 'zones.db');
const db: DatabaseType = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    camera_id TEXT,
    polygon TEXT NOT NULL,
    min_blob_area INTEGER DEFAULT 500,
    max_blob_area INTEGER DEFAULT 50000,
    alarm_threshold INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS background_frames (
    camera_id TEXT PRIMARY KEY,
    frame_data BLOB,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS occupancy_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id TEXT NOT NULL,
    count INTEGER NOT NULL,
    blob_details TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );

  CREATE TABLE IF NOT EXISTS parking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id TEXT NOT NULL,
    zone_name TEXT,
    camera_id TEXT,
    event_type TEXT NOT NULL,
    count_before INTEGER,
    count_after INTEGER,
    duration_seconds INTEGER,
    entry_time TEXT,
    exit_time TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );

  CREATE INDEX IF NOT EXISTS idx_parking_events_timestamp ON parking_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_parking_events_zone ON parking_events(zone_id);
`);

export interface Zone {
  id: string;
  name: string;
  camera_id: string | null;
  polygon: { x: number; y: number }[];
  min_blob_area: number;
  max_blob_area: number;
  alarm_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface ZoneInput {
  name: string;
  camera_id?: string;
  polygon: { x: number; y: number }[];
  min_blob_area?: number;
  max_blob_area?: number;
  alarm_threshold?: number;
}

export function createZone(id: string, input: ZoneInput): Zone {
  const stmt = db.prepare(`
    INSERT INTO zones (id, name, camera_id, polygon, min_blob_area, max_blob_area, alarm_threshold)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    input.name,
    input.camera_id || null,
    JSON.stringify(input.polygon),
    input.min_blob_area || 500,
    input.max_blob_area || 50000,
    input.alarm_threshold || 1
  );
  
  return getZone(id)!;
}

export function getZone(id: string): Zone | null {
  const stmt = db.prepare('SELECT * FROM zones WHERE id = ?');
  const row = stmt.get(id) as any;
  if (!row) return null;
  
  return {
    ...row,
    polygon: JSON.parse(row.polygon)
  };
}

export function getAllZones(): Zone[] {
  const stmt = db.prepare('SELECT * FROM zones ORDER BY created_at DESC');
  const rows = stmt.all() as any[];
  return rows.map(row => ({
    ...row,
    polygon: JSON.parse(row.polygon)
  }));
}

export function updateZone(id: string, input: Partial<ZoneInput>): Zone | null {
  const zone = getZone(id);
  if (!zone) return null;
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.camera_id !== undefined) {
    updates.push('camera_id = ?');
    values.push(input.camera_id);
  }
  if (input.polygon !== undefined) {
    updates.push('polygon = ?');
    values.push(JSON.stringify(input.polygon));
  }
  if (input.min_blob_area !== undefined) {
    updates.push('min_blob_area = ?');
    values.push(input.min_blob_area);
  }
  if (input.max_blob_area !== undefined) {
    updates.push('max_blob_area = ?');
    values.push(input.max_blob_area);
  }
  if (input.alarm_threshold !== undefined) {
    updates.push('alarm_threshold = ?');
    values.push(input.alarm_threshold);
  }
  
  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    const stmt = db.prepare(`UPDATE zones SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }
  
  return getZone(id);
}

export function deleteZone(id: string): boolean {
  // Delete related records first to avoid FK constraints
  db.prepare('DELETE FROM occupancy_log WHERE zone_id = ?').run(id);
  db.prepare('DELETE FROM parking_events WHERE zone_id = ?').run(id);
  
  const stmt = db.prepare('DELETE FROM zones WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function saveBackgroundFrame(cameraId: string, frameData: Buffer): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO background_frames (camera_id, frame_data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(cameraId, frameData);
}

export function getBackgroundFrame(cameraId: string): Buffer | null {
  const stmt = db.prepare('SELECT frame_data FROM background_frames WHERE camera_id = ?');
  const row = stmt.get(cameraId) as any;
  return row?.frame_data || null;
}

export function logOccupancy(zoneId: string, count: number, blobDetails?: any): void {
  const stmt = db.prepare(`
    INSERT INTO occupancy_log (zone_id, count, blob_details)
    VALUES (?, ?, ?)
  `);
  stmt.run(zoneId, count, blobDetails ? JSON.stringify(blobDetails) : null);
}

export function getRecentOccupancy(zoneId: string, limit = 100): any[] {
  const stmt = db.prepare(`
    SELECT * FROM occupancy_log 
    WHERE zone_id = ? 
    ORDER BY timestamp DESC 
    LIMIT ?
  `);
  return stmt.all(zoneId, limit) as any[];
}

// ============ PARKING EVENTS ============

export interface ParkingEvent {
  id: number;
  zone_id: string;
  zone_name: string;
  camera_id: string;
  event_type: 'entry' | 'exit' | 'occupancy_change';
  count_before: number;
  count_after: number;
  duration_seconds: number | null;
  entry_time: string | null;
  exit_time: string | null;
  timestamp: string;
}

// Track active sessions per zone (for duration calculation)
const activeZoneSessions: Map<string, { entryTime: Date; count: number }> = new Map();

export function logParkingEvent(
  zoneId: string,
  zoneName: string,
  cameraId: string,
  countBefore: number,
  countAfter: number
): ParkingEvent | null {
  const now = new Date();
  const nowStr = now.toISOString();
  
  // Determine event type
  let eventType: 'entry' | 'exit' | 'occupancy_change';
  let durationSeconds: number | null = null;
  let entryTime: string | null = null;
  let exitTime: string | null = null;
  
  if (countBefore === 0 && countAfter > 0) {
    // Entry event - vehicle(s) entered empty zone
    eventType = 'entry';
    entryTime = nowStr;
    activeZoneSessions.set(zoneId, { entryTime: now, count: countAfter });
  } else if (countBefore > 0 && countAfter === 0) {
    // Exit event - zone became empty
    eventType = 'exit';
    exitTime = nowStr;
    
    // Calculate duration from entry
    const session = activeZoneSessions.get(zoneId);
    if (session) {
      durationSeconds = Math.round((now.getTime() - session.entryTime.getTime()) / 1000);
      entryTime = session.entryTime.toISOString();
      activeZoneSessions.delete(zoneId);
    }
  } else if (countBefore !== countAfter) {
    // Occupancy change (not entry/exit, just count changed)
    eventType = 'occupancy_change';
  } else {
    // No change - don't log
    return null;
  }
  
  const stmt = db.prepare(`
    INSERT INTO parking_events (zone_id, zone_name, camera_id, event_type, count_before, count_after, duration_seconds, entry_time, exit_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(zoneId, zoneName, cameraId, eventType, countBefore, countAfter, durationSeconds, entryTime, exitTime);
  
  return {
    id: result.lastInsertRowid as number,
    zone_id: zoneId,
    zone_name: zoneName,
    camera_id: cameraId,
    event_type: eventType,
    count_before: countBefore,
    count_after: countAfter,
    duration_seconds: durationSeconds,
    entry_time: entryTime,
    exit_time: exitTime,
    timestamp: nowStr
  };
}

export function getParkingEvents(options: {
  limit?: number;
  offset?: number;
  zoneId?: string;
  cameraId?: string;
  eventType?: string;
  since?: string;
  until?: string;
} = {}): { events: ParkingEvent[]; total: number } {
  const { limit = 100, offset = 0, zoneId, cameraId, eventType, since, until } = options;
  
  let whereClause = '1=1';
  const params: any[] = [];
  
  if (zoneId) {
    whereClause += ' AND zone_id = ?';
    params.push(zoneId);
  }
  if (cameraId) {
    whereClause += ' AND camera_id = ?';
    params.push(cameraId);
  }
  if (eventType) {
    whereClause += ' AND event_type = ?';
    params.push(eventType);
  }
  if (since) {
    whereClause += ' AND timestamp >= ?';
    params.push(since);
  }
  if (until) {
    whereClause += ' AND timestamp <= ?';
    params.push(until);
  }
  
  // Get total count
  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM parking_events WHERE ${whereClause}`);
  const totalRow = countStmt.get(...params) as { total: number };
  
  // Get events
  const stmt = db.prepare(`
    SELECT * FROM parking_events 
    WHERE ${whereClause}
    ORDER BY timestamp DESC 
    LIMIT ? OFFSET ?
  `);
  
  const events = stmt.all(...params, limit, offset) as ParkingEvent[];
  
  return { events, total: totalRow.total };
}

export function getParkingStats(since?: string): {
  totalEntries: number;
  totalExits: number;
  avgDurationSeconds: number;
  currentOccupied: number;
  byZone: { zone_id: string; zone_name: string; entries: number; exits: number; avgDuration: number }[];
} {
  const sinceClause = since ? `AND timestamp >= '${since}'` : '';
  
  const totalStmt = db.prepare(`
    SELECT 
      SUM(CASE WHEN event_type = 'entry' THEN 1 ELSE 0 END) as entries,
      SUM(CASE WHEN event_type = 'exit' THEN 1 ELSE 0 END) as exits,
      AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds END) as avg_duration
    FROM parking_events
    WHERE 1=1 ${sinceClause}
  `);
  const totals = totalStmt.get() as any;
  
  const byZoneStmt = db.prepare(`
    SELECT 
      zone_id,
      zone_name,
      SUM(CASE WHEN event_type = 'entry' THEN 1 ELSE 0 END) as entries,
      SUM(CASE WHEN event_type = 'exit' THEN 1 ELSE 0 END) as exits,
      AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds END) as avg_duration
    FROM parking_events
    WHERE 1=1 ${sinceClause}
    GROUP BY zone_id, zone_name
    ORDER BY entries DESC
  `);
  const byZone = byZoneStmt.all() as any[];
  
  // Count currently occupied zones
  const occupiedStmt = db.prepare(`SELECT COUNT(*) as count FROM (SELECT zone_id FROM parking_events WHERE event_type = 'entry' GROUP BY zone_id HAVING MAX(id) IN (SELECT MAX(id) FROM parking_events WHERE event_type = 'entry' GROUP BY zone_id))`);
  const occupied = activeZoneSessions.size;
  
  return {
    totalEntries: totals.entries || 0,
    totalExits: totals.exits || 0,
    avgDurationSeconds: Math.round(totals.avg_duration || 0),
    currentOccupied: occupied,
    byZone: byZone.map(z => ({
      zone_id: z.zone_id,
      zone_name: z.zone_name,
      entries: z.entries || 0,
      exits: z.exits || 0,
      avgDuration: Math.round(z.avg_duration || 0)
    }))
  };
}

export default db;
