import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import type { CameraData } from '../types'
import { getApiUrl } from '../lib/utils'
import { FiCamera, FiMapPin, FiRadio } from 'react-icons/fi'

interface CameraCardProps {
  camera: CameraData
  onClick: () => void
  isSelected: boolean
}

export function CameraCard({ camera, onClick, isSelected }: CameraCardProps) {
  const { roundRobinStatus, editMode } = useStore()
  const [imageKey, setImageKey] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const isScanning = roundRobinStatus?.currentCamera === camera.camera_id

  // Auto-refresh image every 5 seconds (but not when editing)
  useEffect(() => {
    if (editMode) return
    const interval = setInterval(() => setImageKey((k) => k + 1), 5000)
    return () => clearInterval(interval)
  }, [editMode])

  const hasAlarm = camera.zones.some((z) => z.alarm)
  const totalCount = camera.zones.reduce((sum, z) => sum + z.count, 0)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`glass rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${
        isSelected
          ? 'ring-2 ring-cyan-500 glow-cyan'
          : hasAlarm
          ? 'ring-2 ring-red-500/50'
          : 'hover:ring-1 hover:ring-cyan-500/30'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center p-3 bg-black/30">
        <div className="flex items-center gap-2">
          <FiCamera className="text-cyan-400" />
          <span className="font-medium text-sm truncate">{camera.camera_id}</span>
        </div>
        <div className="flex items-center gap-2">
          {isScanning && (
            <motion.div
              className="badge-cyan flex items-center gap-1"
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              <FiRadio className="text-xs" />
              Live
            </motion.div>
          )}
          <span className="badge-green flex items-center gap-1">
            <FiMapPin className="text-xs" />
            {camera.zones.length}
          </span>
        </div>
      </div>

      {/* Image Preview */}
      <div className="relative aspect-video bg-black">
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        )}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <FiCamera className="text-3xl" />
          </div>
        )}
        <img
          key={imageKey}
          src={`${getApiUrl()}/frame/${camera.camera_id}?t=${imageKey}`}
          alt={camera.camera_id}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => {
            setImageLoaded(true)
            setImageError(false)
          }}
          onError={() => {
            setImageError(true)
            setImageLoaded(false)
          }}
          loading="lazy"
        />

        {/* Overlay indicators */}
        {hasAlarm && (
          <motion.div
            className="absolute top-2 right-2 px-2 py-1 bg-red-500 rounded text-xs font-bold text-white"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >
            ⚠️ ALARM
          </motion.div>
        )}

        {/* Total count overlay */}
        {totalCount > 0 && (
          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 rounded-lg backdrop-blur-sm">
            <span className="text-lg font-bold text-cyan-400">{totalCount}</span>
            <span className="text-xs text-gray-400 ml-1">objects</span>
          </div>
        )}
      </div>

      {/* Zones List */}
      <div className="p-3">
        {camera.zones.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-2">No zones configured</p>
        ) : (
          <div className="space-y-1">
            {camera.zones.slice(0, 3).map((zone) => (
              <motion.div
                key={zone.id}
                className={`flex justify-between items-center p-2 rounded-lg ${
                  zone.alarm
                    ? 'bg-red-500/20 border border-red-500/50'
                    : 'bg-noc-bg/50'
                }`}
                animate={zone.alarm ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 0.5, repeat: zone.alarm ? Infinity : 0 }}
              >
                <span className="text-xs text-gray-300 truncate">{zone.name}</span>
                <span
                  className={`text-sm font-bold ${
                    zone.alarm
                      ? 'text-red-400'
                      : zone.count > 0
                      ? 'text-green-400'
                      : 'text-gray-500'
                  }`}
                >
                  {zone.count}
                </span>
              </motion.div>
            ))}
            {camera.zones.length > 3 && (
              <p className="text-xs text-gray-500 text-center pt-1">
                +{camera.zones.length - 3} more zones
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
