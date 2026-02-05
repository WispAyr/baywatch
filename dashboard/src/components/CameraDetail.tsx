import { useState, useRef, useEffect, useMemo, type MouseEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { getApiUrl } from '../lib/utils'
import type { Zone, Point, CameraZone } from '../types'
import toast from 'react-hot-toast'
import {
  FiX,
  FiEdit3,
  FiCheck,
  FiTrash2,
  FiPlus,
  FiRefreshCw,
} from 'react-icons/fi'

export function CameraDetail() {
  const {
    selectedCamera,
    setSelectedCamera,
    zones,
    occupancy,
    editMode,
    setEditMode,
    saveZone,
    deleteZone,
    refreshZones,
  } = useStore()

  const [editingZone, setEditingZone] = useState<Partial<Zone> | null>(null)
  const [drawingPolygon, setDrawingPolygon] = useState<Point[]>([])
  const [imageDimensions, setImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null)
  const [imageKey, setImageKey] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const cameraZones: CameraZone[] = useMemo(() => {
    return zones
      .filter((z) => z.camera_id === selectedCamera)
      .map((z) => ({
        ...z,
        count: occupancy.get(z.id)?.count ?? 0,
        alarm: occupancy.get(z.id)?.alarm ?? false,
      }))
  }, [zones, selectedCamera, occupancy])

  // Draw polygon on canvas
  useEffect(() => {
    if (!canvasRef.current || !imageDimensions || !editMode) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, imageDimensions.width, imageDimensions.height)

    // Draw existing zones for this camera
    zones
      .filter((z) => z.camera_id === selectedCamera)
      .forEach((zone) => {
        if (zone.polygon.length < 2) return
        ctx.beginPath()
        ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y)
        zone.polygon.forEach((p) => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        ctx.fillStyle = 'rgba(0, 255, 255, 0.15)'
        ctx.fill()
        ctx.strokeStyle = '#00e5ff'
        ctx.lineWidth = 2
        ctx.stroke()

        // Label with background
        const labelX = zone.polygon[0].x + 5
        const labelY = zone.polygon[0].y + 20
        ctx.font = 'bold 14px Inter, sans-serif'
        const textWidth = ctx.measureText(zone.name).width
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(labelX - 2, labelY - 14, textWidth + 4, 18)
        ctx.fillStyle = '#00e5ff'
        ctx.fillText(zone.name, labelX, labelY)
      })

    // Draw current drawing polygon
    if (drawingPolygon.length > 0) {
      ctx.beginPath()
      ctx.moveTo(drawingPolygon[0].x, drawingPolygon[0].y)
      drawingPolygon.forEach((p) => ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = 3
      ctx.stroke()

      // Draw points
      drawingPolygon.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
        ctx.fillStyle = i === 0 ? '#ef4444' : '#f97316'
        ctx.fill()
        ctx.strokeStyle = 'white'
        ctx.lineWidth = 2
        ctx.stroke()
      })
    }
  }, [drawingPolygon, zones, selectedCamera, imageDimensions, editMode])

  // Get coordinates in native image space
  const getImageCoords = (
    e: MouseEvent<HTMLCanvasElement>
  ): Point | null => {
    if (!canvasRef.current || !imageRef.current || !imageDimensions) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = imageDimensions.width / rect.width
    const scaleY = imageDimensions.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    }
  }

  const findNearbyPoint = (
    coords: Point,
    points: Point[],
    threshold = 30
  ): number => {
    for (let i = 0; i < points.length; i++) {
      const dist = Math.sqrt(
        (coords.x - points[i].x) ** 2 + (coords.y - points[i].y) ** 2
      )
      if (dist < threshold) return i
    }
    return -1
  }

  const handleCanvasMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!editMode) return
    const coords = getImageCoords(e)
    if (!coords) return

    const nearbyIndex = findNearbyPoint(coords, drawingPolygon, 40)
    if (nearbyIndex >= 0) {
      setDraggingPointIndex(nearbyIndex)
      return
    }

    if (drawingPolygon.length >= 3) {
      const first = drawingPolygon[0]
      const dist = Math.sqrt(
        (coords.x - first.x) ** 2 + (coords.y - first.y) ** 2
      )
      if (dist < 40) {
        // Close polygon
        setEditingZone({
          camera_id: selectedCamera || '',
          polygon: [...drawingPolygon],
          min_blob_area: 500,
          max_blob_area: 50000,
          alarm_threshold: 3,
          name: '',
        })
        return
      }
    }

    setDrawingPolygon([...drawingPolygon, coords])
  }

  const handleCanvasMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (draggingPointIndex === null) return
    const coords = getImageCoords(e)
    if (!coords) return
    const newPolygon = [...drawingPolygon]
    newPolygon[draggingPointIndex] = coords
    setDrawingPolygon(newPolygon)
  }

  const handleCanvasMouseUp = () => {
    setDraggingPointIndex(null)
  }

  const handleCanvasContextMenu = (e: MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!editMode || drawingPolygon.length <= 3) return
    const coords = getImageCoords(e)
    if (!coords) return
    const nearbyIndex = findNearbyPoint(coords, drawingPolygon, 40)
    if (nearbyIndex >= 0) {
      setDrawingPolygon(drawingPolygon.filter((_, i) => i !== nearbyIndex))
    }
  }

  const handleSaveZone = async () => {
    if (!editingZone || !editingZone.name || !editingZone.polygon?.length) {
      toast.error('Please provide a zone name')
      return
    }

    const success = await saveZone(editingZone)
    if (success) {
      toast.success(editingZone.id ? 'Zone updated' : 'Zone created')
      setEditingZone(null)
      setDrawingPolygon([])
    } else {
      toast.error('Failed to save zone')
    }
  }

  const handleDeleteZone = async (zoneId: string, zoneName: string) => {
    const success = await deleteZone(zoneId)
    if (success) {
      toast.success(`Deleted zone: ${zoneName}`)
    } else {
      toast.error('Failed to delete zone')
    }
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
  }

  const closeModal = () => {
    setSelectedCamera(null)
    setEditMode(false)
    setDrawingPolygon([])
    setEditingZone(null)
  }

  if (!selectedCamera) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={closeModal}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', damping: 25 }}
          className="glass-elevated rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-noc-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xl">
                📷
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{selectedCamera}</h2>
                <p className="text-xs text-gray-500">
                  {cameraZones.length} zones configured
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setEditMode(!editMode)
                  setDrawingPolygon([])
                  setEditingZone(null)
                }}
                className={editMode ? 'btn-success' : 'btn-secondary'}
              >
                {editMode ? (
                  <>
                    <FiCheck className="inline mr-1" /> Done
                  </>
                ) : (
                  <>
                    <FiEdit3 className="inline mr-1" /> Edit
                  </>
                )}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={closeModal}
                className="w-10 h-10 rounded-lg bg-noc-elevated hover:bg-red-500/20 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors"
              >
                <FiX />
              </motion.button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Image / Canvas */}
              <div className="lg:col-span-2">
                <div className="relative rounded-xl overflow-hidden bg-black">
                  <img
                    ref={imageRef}
                    src={`${getApiUrl()}/frame/${selectedCamera}?t=${
                      editMode ? 'edit' : imageKey
                    }`}
                    alt={selectedCamera}
                    className="w-full"
                    onLoad={handleImageLoad}
                  />
                  {editMode && imageDimensions && (
                    <canvas
                      ref={canvasRef}
                      width={imageDimensions.width}
                      height={imageDimensions.height}
                      className="absolute top-0 left-0 w-full h-full cursor-crosshair"
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                      onContextMenu={handleCanvasContextMenu}
                    />
                  )}
                </div>
                {!editMode && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setImageKey((k) => k + 1)}
                    className="mt-2 btn-secondary flex items-center gap-2"
                  >
                    <FiRefreshCw /> Refresh Frame
                  </motion.button>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {editMode ? (
                  <>
                    {/* Zone Editor */}
                    <div className="glass rounded-xl p-4">
                      <h3 className="text-lg font-medium text-cyan-400 mb-3">
                        Zone Editor
                      </h3>

                      {editingZone ? (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-3"
                        >
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">
                              Zone Name
                            </label>
                            <input
                              type="text"
                              value={editingZone.name || ''}
                              onChange={(e) =>
                                setEditingZone({
                                  ...editingZone,
                                  name: e.target.value,
                                })
                              }
                              placeholder="e.g., Bay A1"
                              className="input"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">
                              Alarm Threshold
                            </label>
                            <input
                              type="number"
                              value={editingZone.alarm_threshold || 3}
                              onChange={(e) =>
                                setEditingZone({
                                  ...editingZone,
                                  alarm_threshold: parseInt(e.target.value),
                                })
                              }
                              min="1"
                              className="input"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">
                                Min Area (px)
                              </label>
                              <input
                                type="number"
                                value={editingZone.min_blob_area || 500}
                                onChange={(e) =>
                                  setEditingZone({
                                    ...editingZone,
                                    min_blob_area: parseInt(e.target.value),
                                  })
                                }
                                min="100"
                                className="input"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">
                                Max Area (px)
                              </label>
                              <input
                                type="number"
                                value={editingZone.max_blob_area || 50000}
                                onChange={(e) =>
                                  setEditingZone({
                                    ...editingZone,
                                    max_blob_area: parseInt(e.target.value),
                                  })
                                }
                                min="1000"
                                className="input"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={handleSaveZone}
                              className="btn-primary flex-1"
                            >
                              💾 Save
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => {
                                setEditingZone(null)
                                setDrawingPolygon([])
                              }}
                              className="btn-secondary"
                            >
                              Cancel
                            </motion.button>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="glass-elevated rounded-lg p-4 text-center space-y-2">
                          <p className="text-sm text-gray-400">
                            👆 <strong>Click</strong> to add points
                          </p>
                          <p className="text-sm text-gray-400">
                            🔴 Click near first point to close
                          </p>
                          <p className="text-sm text-gray-400">
                            ✋ <strong>Drag</strong> points to move
                          </p>
                          <p className="text-sm text-gray-400">
                            🖱️ <strong>Right-click</strong> to delete point
                          </p>
                          {drawingPolygon.length > 0 && (
                            <>
                              <p className="text-cyan-400 font-medium pt-2">
                                {drawingPolygon.length} points drawn
                              </p>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setDrawingPolygon([])}
                                className="btn-danger w-full"
                              >
                                🗑 Clear Points
                              </motion.button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Existing Zones */}
                    <div className="glass rounded-xl p-4">
                      <h4 className="text-sm font-medium text-gray-400 mb-3">
                        Existing Zones
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {cameraZones.map((zone) => (
                          <motion.div
                            key={zone.id}
                            className="flex justify-between items-center p-2 rounded-lg bg-noc-bg hover:bg-noc-elevated transition-colors"
                            whileHover={{ x: 2 }}
                          >
                            <span className="text-sm text-gray-300 truncate">
                              {zone.name}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  setEditingZone(zone)
                                  setDrawingPolygon(zone.polygon)
                                }}
                                className="p-1.5 rounded hover:bg-cyan-500/20 text-cyan-400"
                              >
                                <FiEdit3 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteZone(zone.id, zone.name)}
                                className="p-1.5 rounded hover:bg-red-500/20 text-red-400"
                              >
                                <FiTrash2 size={14} />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                        {cameraZones.length === 0 && (
                          <p className="text-xs text-gray-500 text-center py-4">
                            No zones yet. Draw one on the image!
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  /* Zone Status View */
                  <div className="glass rounded-xl p-4">
                    <h3 className="text-lg font-medium text-cyan-400 mb-3">
                      Zone Status
                    </h3>
                    <div className="space-y-2">
                      {cameraZones.map((zone) => (
                        <motion.div
                          key={zone.id}
                          className={`p-3 rounded-lg ${
                            zone.alarm
                              ? 'bg-red-500/20 border border-red-500/50'
                              : 'bg-noc-bg'
                          }`}
                          animate={zone.alarm ? { scale: [1, 1.02, 1] } : {}}
                          transition={{
                            duration: 0.5,
                            repeat: zone.alarm ? Infinity : 0,
                          }}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-gray-200">
                              {zone.name}
                            </span>
                            <span
                              className={`text-xl font-bold ${
                                zone.alarm
                                  ? 'text-red-400'
                                  : zone.count > 0
                                  ? 'text-green-400'
                                  : 'text-gray-500'
                              }`}
                            >
                              {zone.count}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            Threshold: {zone.alarm_threshold} | Area:{' '}
                            {zone.min_blob_area}-{zone.max_blob_area}px
                          </p>
                        </motion.div>
                      ))}
                      {cameraZones.length === 0 && (
                        <div className="text-center py-8">
                          <FiPlus className="text-4xl text-gray-600 mx-auto mb-2" />
                          <p className="text-sm text-gray-500">
                            No zones configured.
                          </p>
                          <p className="text-xs text-gray-600">
                            Click "Edit" to add zones.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
