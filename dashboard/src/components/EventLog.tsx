import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { formatDuration, formatTime } from '../lib/utils'
import { EventLogSkeleton } from './Skeletons'
import { FiX, FiLogIn, FiLogOut, FiRefreshCw, FiTrendingUp, FiTrendingDown, FiClock, FiLayers } from 'react-icons/fi'

export function EventLog() {
  const {
    showEventLog,
    setShowEventLog,
    events,
    eventStats,
    refreshEvents,
  } = useStore()

  // Auto-refresh events when panel is open
  useEffect(() => {
    if (!showEventLog) return
    refreshEvents()
    const interval = setInterval(refreshEvents, 10000)
    return () => clearInterval(interval)
  }, [showEventLog, refreshEvents])

  if (!showEventLog) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onClick={() => setShowEventLog(false)}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25 }}
          className="glass-elevated rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-noc-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-400 text-xl">
                📋
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Event Log</h2>
                <p className="text-xs text-gray-500">Parking activity history</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowEventLog(false)}
              className="w-10 h-10 rounded-lg bg-noc-elevated hover:bg-red-500/20 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors"
            >
              <FiX />
            </motion.button>
          </div>

          {/* Content */}
          <div className="p-4 overflow-y-auto flex-1">
            {!eventStats ? (
              <EventLogSkeleton />
            ) : (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="glass rounded-xl p-4 text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <FiTrendingUp className="text-green-400" />
                      <span className="text-2xl font-bold text-green-400">
                        {eventStats.totalEntries}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">
                      Entries
                    </span>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="glass rounded-xl p-4 text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <FiTrendingDown className="text-red-400" />
                      <span className="text-2xl font-bold text-red-400">
                        {eventStats.totalExits}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">
                      Exits
                    </span>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="glass rounded-xl p-4 text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <FiLayers className="text-cyan-400" />
                      <span className="text-2xl font-bold text-cyan-400">
                        {eventStats.currentOccupied}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">
                      Occupied
                    </span>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="glass rounded-xl p-4 text-center"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <FiClock className="text-purple-400" />
                      <span className="text-2xl font-bold text-purple-400">
                        {eventStats.avgDurationSeconds > 0
                          ? formatDuration(eventStats.avgDurationSeconds)
                          : '-'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 uppercase tracking-wider">
                      Avg Stay
                    </span>
                  </motion.div>
                </div>

                {/* Events Table */}
                <div className="glass rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-noc-bg text-left">
                        <th className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time
                        </th>
                        <th className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Zone
                        </th>
                        <th className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Event
                        </th>
                        <th className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Count
                        </th>
                        <th className="p-3 text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                          Duration
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-gray-500"
                          >
                            No events recorded yet
                          </td>
                        </tr>
                      ) : (
                        events.map((event, index) => (
                          <motion.tr
                            key={event.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.02 }}
                            className={`border-b border-noc-border/50 ${
                              event.event_type === 'entry'
                                ? 'bg-green-500/5'
                                : event.event_type === 'exit'
                                ? 'bg-red-500/5'
                                : ''
                            }`}
                          >
                            <td className="p-3 text-sm text-gray-400 font-mono">
                              {formatTime(event.timestamp)}
                            </td>
                            <td className="p-3 text-sm text-gray-200 font-medium">
                              {event.zone_name}
                            </td>
                            <td className="p-3">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                                  event.event_type === 'entry'
                                    ? 'bg-green-500/20 text-green-400'
                                    : event.event_type === 'exit'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'bg-cyan-500/20 text-cyan-400'
                                }`}
                              >
                                {event.event_type === 'entry' && (
                                  <>
                                    <FiLogIn /> Entry
                                  </>
                                )}
                                {event.event_type === 'exit' && (
                                  <>
                                    <FiLogOut /> Exit
                                  </>
                                )}
                                {event.event_type === 'occupancy_change' && (
                                  <>
                                    <FiRefreshCw /> Change
                                  </>
                                )}
                              </span>
                            </td>
                            <td className="p-3 text-sm font-mono">
                              <span className="text-gray-500">
                                {event.count_before}
                              </span>
                              <span className="text-gray-600 mx-1">→</span>
                              <span
                                className={
                                  event.count_after > event.count_before
                                    ? 'text-green-400'
                                    : event.count_after < event.count_before
                                    ? 'text-red-400'
                                    : 'text-gray-400'
                                }
                              >
                                {event.count_after}
                              </span>
                            </td>
                            <td className="p-3 text-sm text-purple-400 hidden sm:table-cell">
                              {event.duration_seconds
                                ? formatDuration(event.duration_seconds)
                                : '-'}
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
