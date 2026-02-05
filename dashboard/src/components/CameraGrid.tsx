import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { CameraCard } from './CameraCard'
import { CameraCardSkeleton } from './Skeletons'
import type { CameraData } from '../types'

export function CameraGrid() {
  const {
    cameras,
    zones,
    occupancy,
    selectedCamera,
    setSelectedCamera,
    loading,
  } = useStore()

  const cameraData: CameraData[] = useMemo(() => {
    return cameras.map((cam) => ({
      camera_id: cam,
      zones: zones
        .filter((z) => z.camera_id === cam)
        .map((z) => ({
          ...z,
          count: occupancy.get(z.id)?.count ?? 0,
          alarm: occupancy.get(z.id)?.alarm ?? false,
        })),
    }))
  }, [cameras, zones, occupancy])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <CameraCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (cameras.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="glass rounded-xl p-12 text-center"
      >
        <div className="text-6xl mb-4">📷</div>
        <h3 className="text-xl font-medium text-gray-300 mb-2">No Cameras Found</h3>
        <p className="text-gray-500">
          Configure cameras in the Baywatch backend to start monitoring.
        </p>
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
    >
      {cameraData.map((camera, index) => (
        <motion.div
          key={camera.camera_id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <CameraCard
            camera={camera}
            isSelected={selectedCamera === camera.camera_id}
            onClick={() =>
              setSelectedCamera(
                selectedCamera === camera.camera_id ? null : camera.camera_id
              )
            }
          />
        </motion.div>
      ))}
    </motion.div>
  )
}
