import { useState } from 'react'
import TaskCard from './TaskCard'

const FILTERS = ['all', 'pending', 'in-progress', 'completed', 'approved']

const FILTER_STYLE = {
  active:   'bg-indigo-600 text-white',
  inactive: 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700',
}

export default function TaskSection({ title, tasks, loading, showAssignee, showSender, showGroup }) {
  const [filter, setFilter] = useState('all')

  const visible = filter === 'all'
    ? tasks
    : tasks.filter((t) => t.status === filter)

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
            {visible.length}
          </span>
          {/* Live dot */}
          <span className="flex items-center gap-1 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live
          </span>
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full transition capitalize
                ${filter === f ? FILTER_STYLE.active : FILTER_STYLE.inactive}`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>

      {/* Task cards */}
      {loading && (
        <p className="text-slate-500 text-sm">Connecting to Firestore…</p>
      )}

      {!loading && visible.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6
          text-center text-slate-500 text-sm">
          No {filter === 'all' ? '' : filter + ' '}tasks here.
        </div>
      )}

      <div className="space-y-2.5">
        {visible.map((task, i) => (
          <TaskCard
            key={task.task_id}
            task={task}
            index={i}
            showAssignee={showAssignee}
            showSender={showSender}
            showGroup={showGroup}
          />
        ))}
      </div>
    </div>
  )
}
