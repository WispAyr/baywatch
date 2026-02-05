export interface Zone {
  id: string
  name: string
  camera_id: string
  polygon: Point[]
  min_blob_area: number
  max_blob_area: number
  alarm_threshold: number
}

export interface Point {
  x: number
  y: number
}

export interface OccupancyData {
  count: number
  alarm: boolean
}

export interface OccupancyUpdate {
  type: 'occupancy_update'
  zone_id: string
  zone_name: string
  camera_id?: string
  count: number
  alarm: boolean
  timestamp: string
}

export interface InitialState {
  type: 'initial_state'
  zones: Array<{ zone_id: string; count: number }>
}

export interface ModeChanged {
  type: 'mode_changed'
  mode: string
}

export type WebSocketMessage = OccupancyUpdate | InitialState | ModeChanged

export interface RoundRobinStatus {
  enabled: boolean
  currentCamera: string | null
  intervalMs: number
}

export interface DetectionMode {
  mode: string
  name: string
  description: string
  active: boolean
  available: boolean
}

export interface ParkingEvent {
  id: string
  timestamp: string
  zone_id: string
  zone_name: string
  event_type: 'entry' | 'exit' | 'occupancy_change'
  count_before: number
  count_after: number
  duration_seconds?: number
}

export interface EventStats {
  totalEntries: number
  totalExits: number
  currentOccupied: number
  avgDurationSeconds: number
}

export interface CameraZone extends Zone {
  count: number
  alarm: boolean
}

export interface CameraData {
  camera_id: string
  zones: CameraZone[]
}
