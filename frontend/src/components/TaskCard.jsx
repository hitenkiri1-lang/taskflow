import { useState } from 'react'
import { motion } from 'framer-motion'
import axios from '../api/axios'

const PRIORITY_STYLE = {
  high:   'bg-red-500/10 text-red-400 border border-red-500/30',
  medium: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30',
  low:    'bg-green-500/10 text-green-400 border border-green-500/30',
}

const STATUS_STYLE = {
  pending:       'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  'in-progress': 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  completed:     'bg-green-500/15 text-green-400 border border-green-500/30',
  approved:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
}

const STATUS_DOT = {
  pending:       'bg-amber-400',
  'in-progress': 'bg-blue-400',
  completed:     'bg-green-400',
  approved:      'bg-emerald-400',
}

// Next logical status in the workflow
const NEXT_STATUS = {
  pending:       'in-progress',
  'in-progress': 'completed',
  completed:     'approved',
  approved:      null,
}

const NEXT_LABEL = {
  pending:       'Start',
  'in-progress': 'Complete',
  completed:     'Approve',
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Determine if the current user can update this task's status.
 *
 * Individual task: only the assignee.
 * Group task:      any member except the owner.
 */
function canUpdateStatus({ task, userId, userName, groupMembers, groupOwnerId }) {
  if (!userId) return false

  if (task.group_id) {
    // Group task — need member list to decide client-side
    if (groupMembers && groupOwnerId) {
      if (userId === groupOwnerId) return false
      return groupMembers.includes(userId)
    }
    // No group context passed — optimistically allow; backend will enforce
    return true
  }

  // Individual task — only assignee (task.assignee_name is always set here)
  return (userName || '').toLowerCase() === (task.assignee_name || '').toLowerCase()
}

export default function TaskCard({
  task,
  index,
  showAssignee  = false,
  showSender    = false,
  showGroup     = false,
  groupMembers  = null,   // array of UIDs — passed from GroupDetails
  groupOwnerId  = null,   // UID of group owner
  onStatusChange = null,  // optional callback after successful update
}) {
  const userId   = localStorage.getItem('user_id')
  const userName = localStorage.getItem('name')

  const priority   = task.priority?.toLowerCase() || 'medium'
  const status     = task.status || 'pending'
  const nextStatus = NEXT_STATUS[status]

  const [updating, setUpdating] = useState(false)
  const [localStatus, setLocalStatus] = useState(status)
  const [permError,   setPermError]   = useState(false)

  const allowed = canUpdateStatus({ task, userId, userName, groupMembers, groupOwnerId })

  const handleStatusAdvance = async () => {
    if (!nextStatus || updating) return
    if (!allowed) { setPermError(true); setTimeout(() => setPermError(false), 3000); return }

    setUpdating(true)
    try {
      await axios.post('/tasks/update-status', { task_id: task.task_id, new_status: nextStatus })
      setLocalStatus(nextStatus)
      onStatusChange?.(task.task_id, nextStatus)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Update failed.'
      // Surface permission errors inline
      if (err.response?.status === 403) setPermError(true)
      setTimeout(() => setPermError(false), 4000)
      console.error('[TaskCard] status update error:', msg)
    } finally {
      setUpdating(false)
    }
  }

  const displayStatus = localStatus

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3
        hover:border-slate-600 transition-colors"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-slate-500 shrink-0">
            #{task.task_number ?? '—'}
          </span>
          <p className="font-medium text-white leading-snug truncate">{task.task_title}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLE[priority] || PRIORITY_STYLE.medium}`}>
          {priority}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status badge */}
        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[displayStatus] || STATUS_STYLE.pending}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[displayStatus] || STATUS_DOT.pending}`} />
          {displayStatus}
        </span>

        {/* Due date */}
        {task.due_date && (
          <span className="text-xs text-indigo-400 flex items-center gap-1">
            📅 {formatDate(task.due_date)}
          </span>
        )}

        {/* Group badge */}
        {task.group_name && (
          <span className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            👥 {task.group_name}
          </span>
        )}

        {/* Assignee — only for individual tasks */}
        {showAssignee && task.assignee_name && !task.group_id && (
          <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded-full">
            → {task.assignee_name}
          </span>
        )}

        {/* Sender */}
        {showSender && task.sender_name && (
          <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded-full">
            from {task.sender_name}
          </span>
        )}
      </div>

      {/* Action row */}
      {nextStatus && (
        <div className="flex items-center gap-2 pt-0.5">
          {allowed ? (
            <button
              onClick={handleStatusAdvance}
              disabled={updating}
              className="text-xs px-3 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30
                text-indigo-400 hover:bg-indigo-600/40 hover:text-indigo-300
                disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {updating ? 'Updating…' : `Mark ${NEXT_LABEL[displayStatus] || nextStatus}`}
            </button>
          ) : (
            <span className="text-xs text-slate-600 italic">
              {permError ? '⛔ No permission to update' : 'View only'}
            </span>
          )}
          {permError && allowed === false && (
            <span className="text-xs text-red-400">⛔ No permission to update</span>
          )}
        </div>
      )}
    </motion.div>
  )
}
