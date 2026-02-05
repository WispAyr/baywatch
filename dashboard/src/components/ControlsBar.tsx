import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { FiPlay, FiSquare, FiSettings, FiCpu, FiZap } from 'react-icons/fi'

export function ControlsBar() {
  const {
    roundRobinStatus,
    detectionModes,
    currentMode,
    hailoAvailable,
    showModePanel,
    setShowModePanel,
    toggleRoundRobin,
    changeDetectionMode,
  } = useStore()

  const activeModeInfo = detectionModes.find((m) => m.mode === currentMode)

  return (
    <div className="glass rounded-xl p-4 mb-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        {/* Round Robin Status */}
        <div className="flex items-center gap-3">
          <motion.div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              roundRobinStatus?.enabled
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'bg-gray-700/50 text-gray-400'
            }`}
            animate={
              roundRobinStatus?.enabled
                ? { rotate: 360 }
                : {}
            }
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          >
            🔄
          </motion.div>
          <div>
            <p className="text-sm text-gray-400">
              {roundRobinStatus?.enabled ? (
                <>
                  Scanning:{' '}
                  <span className="text-cyan-400 font-medium">
                    {roundRobinStatus.currentCamera}
                  </span>
                </>
              ) : (
                'Round-robin paused'
              )}
            </p>
            {roundRobinStatus?.enabled && (
              <p className="text-xs text-gray-500">
                {(roundRobinStatus.intervalMs / 1000).toFixed(1)}s interval
              </p>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleRoundRobin}
            className={roundRobinStatus?.enabled ? 'btn-danger' : 'btn-success'}
          >
            {roundRobinStatus?.enabled ? (
              <>
                <FiSquare className="inline mr-1" /> Stop
              </>
            ) : (
              <>
                <FiPlay className="inline mr-1" /> Start
              </>
            )}
          </motion.button>
        </div>

        {/* Detection Mode */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FiCpu className="text-purple-400" />
            <span className="text-sm text-gray-400">
              Mode:{' '}
              <span className="text-purple-400 font-medium">
                {activeModeInfo?.name || currentMode}
              </span>
            </span>
          </div>
          {hailoAvailable && (
            <motion.span
              className="badge-cyan flex items-center gap-1"
              animate={{ opacity: [1, 0.7, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <FiZap className="text-xs" />
              Hailo AI
            </motion.span>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowModePanel(!showModePanel)}
            className="btn-secondary flex items-center gap-2"
          >
            <FiSettings />
            <span className="hidden sm:inline">Settings</span>
          </motion.button>
        </div>
      </div>

      {/* Detection Mode Panel */}
      <AnimatePresence>
        {showModePanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-noc-border">
              <h4 className="text-sm font-medium text-cyan-400 mb-3">
                Detection Modes
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {detectionModes.map((mode) => (
                  <motion.button
                    key={mode.mode}
                    whileHover={{ scale: mode.available ? 1.02 : 1 }}
                    whileTap={{ scale: mode.available ? 0.98 : 1 }}
                    onClick={() => mode.available && changeDetectionMode(mode.mode)}
                    disabled={!mode.available}
                    className={`p-3 rounded-lg text-left transition-all ${
                      mode.active
                        ? 'bg-cyan-500/20 border border-cyan-500/50 glow-cyan'
                        : mode.available
                        ? 'bg-noc-elevated border border-noc-border hover:border-cyan-500/30'
                        : 'bg-noc-bg border border-noc-border opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-white">{mode.name}</span>
                      {mode.active && (
                        <span className="badge-green text-xs">Active</span>
                      )}
                      {!mode.available && (
                        <span className="badge-red text-xs">Unavailable</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{mode.description}</p>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
