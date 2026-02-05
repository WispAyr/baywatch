import { create } from 'zustand'
import type { Zone, OccupancyData, RoundRobinStatus, DetectionMode, ParkingEvent, EventStats } from '../types'

const API_URL = window.location.origin

interface BaywatchStore {
  // Data
  zones: Zone[]
  cameras: string[]
  occupancy: Map<string, OccupancyData>
  roundRobinStatus: RoundRobinStatus | null
  detectionModes: DetectionMode[]
  currentMode: string
  hailoAvailable: boolean
  events: ParkingEvent[]
  eventStats: EventStats | null

  // UI State
  selectedCamera: string | null
  editMode: boolean
  showModePanel: boolean
  showEventLog: boolean
  wsConnected: boolean
  wsReconnecting: boolean
  loading: boolean
  error: string | null

  // Actions
  setZones: (zones: Zone[]) => void
  setCameras: (cameras: string[]) => void
  setOccupancy: (zoneId: string, data: OccupancyData) => void
  setInitialOccupancy: (data: Array<{ zone_id: string; count: number }>) => void
  setRoundRobinStatus: (status: RoundRobinStatus | null) => void
  setDetectionModes: (modes: DetectionMode[]) => void
  setCurrentMode: (mode: string) => void
  setHailoAvailable: (available: boolean) => void
  setEvents: (events: ParkingEvent[]) => void
  setEventStats: (stats: EventStats | null) => void

  setSelectedCamera: (camera: string | null) => void
  setEditMode: (mode: boolean) => void
  setShowModePanel: (show: boolean) => void
  setShowEventLog: (show: boolean) => void
  setWsConnected: (connected: boolean) => void
  setWsReconnecting: (reconnecting: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  // API Actions
  fetchInitialData: () => Promise<void>
  refreshZones: () => Promise<void>
  refreshDetectionModes: () => Promise<void>
  refreshEvents: () => Promise<void>
  toggleRoundRobin: () => Promise<void>
  changeDetectionMode: (mode: string) => Promise<boolean>
  saveZone: (zone: Partial<Zone>) => Promise<boolean>
  deleteZone: (zoneId: string) => Promise<boolean>
}

export const useStore = create<BaywatchStore>((set, get) => ({
  // Initial state
  zones: [],
  cameras: [],
  occupancy: new Map(),
  roundRobinStatus: null,
  detectionModes: [],
  currentMode: 'blob',
  hailoAvailable: false,
  events: [],
  eventStats: null,

  selectedCamera: null,
  editMode: false,
  showModePanel: false,
  showEventLog: false,
  wsConnected: false,
  wsReconnecting: false,
  loading: true,
  error: null,

  // Setters
  setZones: (zones) => set({ zones }),
  setCameras: (cameras) => set({ cameras }),
  setOccupancy: (zoneId, data) => set((state) => {
    const newOcc = new Map(state.occupancy)
    newOcc.set(zoneId, data)
    return { occupancy: newOcc }
  }),
  setInitialOccupancy: (data) => set(() => {
    const newOcc = new Map<string, OccupancyData>()
    data.forEach((z) => newOcc.set(z.zone_id, { count: z.count, alarm: false }))
    return { occupancy: newOcc }
  }),
  setRoundRobinStatus: (status) => set({ roundRobinStatus: status }),
  setDetectionModes: (modes) => set({ detectionModes: modes }),
  setCurrentMode: (mode) => set({ currentMode: mode }),
  setHailoAvailable: (available) => set({ hailoAvailable: available }),
  setEvents: (events) => set({ events }),
  setEventStats: (stats) => set({ eventStats: stats }),

  setSelectedCamera: (camera) => set({ selectedCamera: camera, editMode: false }),
  setEditMode: (mode) => set({ editMode: mode }),
  setShowModePanel: (show) => set({ showModePanel: show }),
  setShowEventLog: (show) => set({ showEventLog: show }),
  setWsConnected: (connected) => set({ wsConnected: connected, wsReconnecting: false }),
  setWsReconnecting: (reconnecting) => set({ wsReconnecting: reconnecting }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // API Actions
  fetchInitialData: async () => {
    set({ loading: true, error: null })
    try {
      const [zonesRes, camerasRes, statusRes] = await Promise.all([
        fetch(`${API_URL}/zones`),
        fetch(`${API_URL}/cameras`),
        fetch(`${API_URL}/round-robin/status`),
      ])

      const zones = await zonesRes.json()
      const camerasData = await camerasRes.json()
      const status = await statusRes.json()

      set({
        zones,
        cameras: camerasData.cameras,
        roundRobinStatus: status,
        loading: false,
      })

      // Fetch detection modes separately (may not exist on all backends)
      get().refreshDetectionModes()
    } catch (err) {
      set({ error: 'Failed to load initial data', loading: false })
    }
  },

  refreshZones: async () => {
    try {
      const res = await fetch(`${API_URL}/zones`)
      const zones = await res.json()
      set({ zones })
    } catch (err) {
      console.error('Failed to refresh zones:', err)
    }
  },

  refreshDetectionModes: async () => {
    try {
      const res = await fetch(`${API_URL}/detection/modes`)
      const data = await res.json()
      set({
        detectionModes: data.modes,
        currentMode: data.currentMode,
        hailoAvailable: data.hailoAvailable,
      })
    } catch {
      // Detection modes endpoint may not exist
    }
  },

  refreshEvents: async () => {
    try {
      const [eventsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/events?limit=50`),
        fetch(`${API_URL}/events/stats`),
      ])
      if (eventsRes.ok) {
        const data = await eventsRes.json()
        set({ events: data.events || [] })
      }
      if (statsRes.ok) {
        const stats = await statsRes.json()
        set({ eventStats: stats })
      }
    } catch (err) {
      console.error('Failed to fetch events:', err)
    }
  },

  toggleRoundRobin: async () => {
    const { roundRobinStatus, cameras } = get()
    try {
      if (roundRobinStatus?.enabled) {
        await fetch(`${API_URL}/round-robin/stop`, { method: 'POST' })
      } else {
        await fetch(`${API_URL}/round-robin/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cameras, interval_ms: 5000 }),
        })
      }
      const status = await fetch(`${API_URL}/round-robin/status`).then((r) => r.json())
      set({ roundRobinStatus: status })
    } catch (err) {
      console.error('Failed to toggle round robin:', err)
    }
  },

  changeDetectionMode: async (mode) => {
    try {
      const res = await fetch(`${API_URL}/detection/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        set({ currentMode: mode, showModePanel: false })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  saveZone: async (zone) => {
    try {
      if (zone.id) {
        await fetch(`${API_URL}/zones/${zone.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(zone),
        })
      } else {
        await fetch(`${API_URL}/zones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(zone),
        })
      }
      await get().refreshZones()
      return true
    } catch {
      return false
    }
  },

  deleteZone: async (zoneId) => {
    try {
      const res = await fetch(`${API_URL}/zones/${zoneId}`, { method: 'DELETE' })
      if (res.ok) {
        await get().refreshZones()
        return true
      }
      return false
    } catch {
      return false
    }
  },
}))
