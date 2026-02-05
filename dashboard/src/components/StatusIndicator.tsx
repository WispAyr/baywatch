import { motion } from 'framer-motion'
import { FiWifi, FiWifiOff } from 'react-icons/fi'

interface StatusIndicatorProps {
  connected: boolean
  reconnecting?: boolean
}

export function StatusIndicator({ connected, reconnecting }: StatusIndicatorProps) {
  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <motion.div
              className="status-online"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <FiWifi className="text-green-400" />
          </>
        ) : (
          <>
            <motion.div
              className={reconnecting ? 'status-warning' : 'status-offline'}
              animate={reconnecting ? { opacity: [1, 0.5, 1] } : {}}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
            <FiWifiOff className={reconnecting ? 'text-orange-400' : 'text-red-400'} />
          </>
        )}
      </div>
      <span className="text-xs text-gray-500 uppercase tracking-wider">
        {connected ? 'Live' : reconnecting ? 'Reconnecting...' : 'Offline'}
      </span>
    </motion.div>
  )
}
