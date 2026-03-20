import { motion } from 'framer-motion'

const CARDS = [
  { key: 'assignedToMe',  label: 'Assigned To Me',  color: 'text-indigo-400',  bg: 'bg-indigo-500/10 border-indigo-500/20' },
  { key: 'assignedByMe',  label: 'Assigned By Me',  color: 'text-purple-400',  bg: 'bg-purple-500/10 border-purple-500/20' },
  { key: 'pending',       label: 'Pending',          color: 'text-amber-400',   bg: 'bg-amber-500/10  border-amber-500/20'  },
  { key: 'inProgress',    label: 'In Progress',      color: 'text-blue-400',    bg: 'bg-blue-500/10   border-blue-500/20'   },
  { key: 'completed',     label: 'Completed',        color: 'text-green-400',   bg: 'bg-green-500/10  border-green-500/20'  },
  { key: 'groupTasks',    label: 'Group Tasks',      color: 'text-cyan-400',    bg: 'bg-cyan-500/10   border-cyan-500/20'   },
]

export default function StatsBar({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {CARDS.map(({ key, label, color, bg }, i) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className={`rounded-xl border p-4 ${bg}`}
        >
          <p className={`text-2xl font-bold ${color}`}>{stats[key] ?? 0}</p>
          <p className="text-xs text-slate-400 mt-1">{label}</p>
        </motion.div>
      ))}
    </div>
  )
}
