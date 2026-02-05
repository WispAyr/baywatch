import { motion } from 'framer-motion'
import { useStore } from '../store'
import { StatusIndicator } from './StatusIndicator'
import { FiActivity, FiAlertTriangle, FiClipboard } from 'react-icons/fi'

export function Header() {
  const {
    occupancy,
    wsConnected,
    wsReconnecting,
    showEventLog,
    setShowEventLog,
  } = useStore()

  const totalOccupancy = Array.from(occupancy.values()).reduce(
    (sum, o) => sum + o.count,
    0
  )
  const alarmedZones = Array.from(occupancy.values()).filter((o) => o.alarm).length

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass rounded-xl p-4 mb-4"
    >
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <motion.div
            className="text-4xl"
            animate={{ rotate: [0, -10, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 5 }}
          >
            🏖️
          </motion.div>
          <div>
            <h1 className="text-2xl font-bold text-gradient">Baywatch</h1>
            <p className="text-xs text-gray-500">Occupancy Monitoring</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6">
          {/* Total Objects */}
          <motion.div
            className="flex flex-col items-center"
            whileHover={{ scale: 1.05 }}
          >
            <div className="flex items-center gap-2">
              <FiActivity className="text-cyan-400" />
              <span className="text-2xl font-bold text-cyan-400">
                {totalOccupancy}
              </span>
            </div>
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              Objects
            </span>
          </motion.div>

          {/* Alarms */}
          <motion.div
            className="flex flex-col items-center"
            animate={alarmedZones > 0 ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 0.5, repeat: alarmedZones > 0 ? Infinity : 0 }}
          >
            <div className="flex items-center gap-2">
              <FiAlertTriangle
                className={alarmedZones > 0 ? 'text-red-400' : 'text-gray-500'}
              />
              <span
                className={`text-2xl font-bold ${
                  alarmedZones > 0 ? 'text-red-400' : 'text-gray-500'
                }`}
              >
                {alarmedZones}
              </span>
            </div>
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              Alarms
            </span>
          </motion.div>

          {/* Connection Status */}
          <StatusIndicator
            connected={wsConnected}
            reconnecting={wsReconnecting}
          />

          {/* Event Log Button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowEventLog(!showEventLog)}
            className={`btn-warning flex items-center gap-2 ${
              showEventLog ? 'glow-orange' : ''
            }`}
          >
            <FiClipboard />
            <span className="hidden sm:inline">
              {showEventLog ? 'Hide Log' : 'Events'}
            </span>
          </motion.button>
        </div>
      </div>
    </motion.header>
  )
}
