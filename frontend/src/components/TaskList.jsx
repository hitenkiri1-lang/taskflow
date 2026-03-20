import { motion } from 'framer-motion'

const PRIORITY = {
  high:   'bg-red-500/10 text-red-400 border border-red-500/30',
  medium: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30',
  low:    'bg-green-500/10 text-green-400 border border-green-500/30',
}

const STATUS = {
  pending:       'bg-slate-700 text-slate-300',
  approved:      'bg-green-500/20 text-green-400',
  'in-progress': 'bg-blue-500/20 text-blue-400',
  done:          'bg-emerald-500/20 text-emerald-400',
  todo:          'bg-slate-700 text-slate-300',
}

function TaskCard({ task, index }) {
  const priority = task.priority?.toLowerCase() || 'medium'
  const status   = task.status || 'pending'
  const createdAt = task.created_at ? new Date(task.created_at).toLocaleDateString() : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-slate-800 border border-slate-700/50 rounded-xl p-4 space-y-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-white leading-snug">{task.task_title}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${PRIORITY[priority] || PRIORITY.medium}`}>
          {priority}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[status] || STATUS.pending}`}>
          {status}
        </span>
        {task.due_date && (
          <span className="text-xs text-indigo-400">📅 {task.due_date}</span>
        )}
        {task.assignee_name && (
          <span className="text-xs text-slate-500">→ {task.assignee_name}</span>
        )}
        {createdAt && <span className="text-xs text-slate-600">{createdAt}</span>}
      </div>

      {task.transcript && (
        <p className="text-xs text-slate-500 italic border-t border-slate-700 pt-2">
          "{task.transcript}"
        </p>
      )}
    </motion.div>
  )
}

export default function TaskList({ tasks, loading }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Tasks assigned to you
          {tasks.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500">({tasks.length})</span>
          )}
        </h2>
        {/* Live indicator */}
        <span className="flex items-center gap-1.5 text-xs text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Live
        </span>
      </div>

      {loading && (
        <p className="text-slate-500 text-sm">Connecting to Firestore…</p>
      )}

      {!loading && tasks.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">
          No tasks assigned to you yet.
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task, i) => (
          <TaskCard key={task.task_id} task={task} index={i} />
        ))}
      </div>
    </div>
  )
}
