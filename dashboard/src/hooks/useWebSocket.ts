import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import type { WebSocketMessage } from '../types'
import toast from 'react-hot-toast'

const RECONNECT_DELAY = 2000
const MAX_RECONNECT_DELAY = 30000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY)

  const {
    setWsConnected,
    setWsReconnecting,
    setOccupancy,
    setInitialOccupancy,
    setCurrentMode,
  } = useStore()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      reconnectDelayRef.current = RECONNECT_DELAY
      toast.success('Connected to live feed', { id: 'ws-status', duration: 2000 })
    }

    ws.onclose = () => {
      setWsConnected(false)
      setWsReconnecting(true)
      
      // Schedule reconnect with exponential backoff
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 1.5,
          MAX_RECONNECT_DELAY
        )
        connect()
      }, reconnectDelayRef.current)
    }

    ws.onerror = () => {
      setWsConnected(false)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage

        if (data.type === 'initial_state' && 'zones' in data) {
          setInitialOccupancy(data.zones)
        } else if (data.type === 'occupancy_update') {
          setOccupancy(data.zone_id, { count: data.count, alarm: data.alarm })
          
          // Show toast for alarms
          if (data.alarm) {
            toast.error(`⚠️ Alarm: ${data.zone_name} - ${data.count} detected`, {
              id: `alarm-${data.zone_id}`,
              duration: 5000,
            })
          }
        } else if (data.type === 'mode_changed' && 'mode' in data) {
          setCurrentMode(data.mode)
          toast.success(`Detection mode: ${data.mode}`, { duration: 2000 })
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }
  }, [setWsConnected, setWsReconnecting, setOccupancy, setInitialOccupancy, setCurrentMode])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  return wsRef
}
