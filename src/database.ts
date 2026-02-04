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

export default db;
