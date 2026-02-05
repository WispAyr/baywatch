import { motion } from 'framer-motion'

export function CameraCardSkeleton() {
  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header skeleton */}
      <div className="flex justify-between items-center p-3 bg-black/30">
        <div className="h-4 w-24 skeleton rounded" />
        <div className="h-4 w-12 skeleton rounded" />
      </div>

      {/* Image skeleton */}
      <div className="aspect-video skeleton" />

      {/* Zones skeleton */}
      <div className="p-3 space-y-2">
        <div className="h-8 skeleton rounded-lg" />
        <div className="h-8 skeleton rounded-lg" />
      </div>
    </div>
  )
}

export function EventLogSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-elevated rounded-lg p-4">
            <div className="h-8 w-16 skeleton rounded mx-auto mb-2" />
            <div className="h-3 w-20 skeleton rounded mx-auto" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 p-3 bg-noc-elevated rounded-lg">
            <div className="h-4 w-16 skeleton rounded" />
            <div className="h-4 w-24 skeleton rounded" />
            <div className="h-4 w-20 skeleton rounded" />
            <div className="h-4 w-12 skeleton rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ZoneEditorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-32 skeleton rounded" />
      <motion.div
        className="h-40 skeleton rounded-lg"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 skeleton rounded-lg" />
        ))}
      </div>
    </div>
  )
}
