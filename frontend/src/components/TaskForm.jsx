import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import axios from '../api/axios'

const PRIORITIES = ['low', 'medium', 'high']

/**
 * TaskForm — unified manual task assignment modal.
 *
 * Modes:
 *   "individual"  — pick a single user (self excluded), calls POST /tasks/create
 *   "group"       — pick a group (owner's groups only), calls POST /tasks/create-group-task
 *                   assigns to ALL members automatically, no user dropdown shown
 *
 * Props:
 *   onClose()          — close the modal
 *   onSuccess(data)    — called with API response on success
 *   forceGroup         — when true, lock to group mode (e.g. opened from GroupDetails)
 *   preselectedGroupId — pre-select a specific group (GroupDetails passes this)
 *   preselectedGroupName
 */
export default function TaskForm({
  onClose,
  onSuccess,
  forceGroup           = false,
  preselectedGroupId   = null,
  preselectedGroupName = null,
}) {
  const currentUserId   = localStorage.getItem('user_id')
  const currentUserName = (localStorage.getItem('name') || '').toLowerCase()

  const [mode,       setMode]       = useState(forceGroup ? 'group' : 'individual')
  const [users,      setUsers]      = useState([])
  const [groups,     setGroups]     = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  const [form, setForm] = useState({
    task_title:    '',
    assignee_name: '',          // individual mode
    group_id:      preselectedGroupId   || '',
    group_name:    preselectedGroupName || '',
    priority:      'medium',
    due_date:      '',
  })

  // Fetch users (for individual mode) and groups (for group mode)
  useEffect(() => {
    axios.get('/users')
      .then((res) => {
        // Exclude the logged-in user from the assignee list
        const others = (res.data.users || []).filter(
          (u) => u.name.toLowerCase() !== currentUserName
        )
        setUsers(others)
      })
      .catch(() => {})

    axios.get('/groups')
      .then((res) => {
        // Only show groups owned by the current user in the assignment dropdown
        const owned = (res.data.groups || []).filter(
          (g) => g.created_by === currentUserId
        )
        setGroups(owned)
      })
      .catch(() => {})
  }, [currentUserName, currentUserId])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'group_id') {
      // Also store group_name so we can display it and send it to the API
      const selected = groups.find((g) => g.group_id === value)
      setForm((f) => ({ ...f, group_id: value, group_name: selected?.group_name || '' }))
    } else {
      setForm((f) => ({ ...f, [name]: value }))
    }
  }

  const isGroupMode = mode === 'group'

  // Validation: title required + assignee (individual) or group (group mode)
  const canSubmit =
    form.task_title.trim() &&
    (isGroupMode ? !!form.group_id : !!form.assignee_name)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)

    try {
      let res
      if (isGroupMode) {
        res = await axios.post('/tasks/create-group-task', {
          group_id:  form.group_id,
          task_title: form.task_title.trim(),
          priority:  form.priority,
          due_date:  form.due_date || null,
        })
      } else {
        res = await axios.post('/tasks/create', {
          task_title:    form.task_title.trim(),
          assignee_name: form.assignee_name,
          priority:      form.priority,
          due_date:      form.due_date || null,
          group_id:      null,
          group_name:    null,
        })
      }
      onSuccess?.(res.data)
      onClose?.()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to assign task.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="font-semibold text-white">Assign Task</p>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition text-lg leading-none"
          >✕</button>
        </div>

        {/* Mode toggle — hidden when forceGroup */}
        {!forceGroup && (
          <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
            {['individual', 'group'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition capitalize
                  ${mode === m
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'}`}
              >
                {m === 'individual' ? '👤 Individual' : '👥 Group'}
              </button>
            ))}
          </div>
        )}

        {/* Group mode label when forced */}
        {forceGroup && preselectedGroupName && (
          <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-3 py-2">
            <span className="text-cyan-400 text-sm">👥</span>
            <span className="text-cyan-300 text-sm font-medium">{preselectedGroupName}</span>
            <span className="text-xs text-slate-500 ml-auto">All members will be assigned</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-2.5 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task title */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Task title</label>
            <input
              name="task_title"
              value={form.task_title}
              onChange={handleChange}
              required
              placeholder="e.g. Fix login bug"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5
                text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Individual: user dropdown */}
          {!isGroupMode && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Assign to</label>
              <select
                name="assignee_name"
                value={form.assignee_name}
                onChange={handleChange}
                required
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5
                  text-sm focus:outline-none focus:border-indigo-500 transition"
              >
                <option value="" disabled>Select a user…</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.name.toLowerCase()}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Group: group dropdown (hidden when preselected) */}
          {isGroupMode && !preselectedGroupId && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Select group</label>
              {groups.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  You don't own any groups yet. Create one from the{' '}
                  <a href="/groups" className="text-indigo-400 hover:text-indigo-300 transition">Groups page</a>.
                </p>
              ) : (
                <>
                  <select
                    name="group_id"
                    value={form.group_id}
                    onChange={handleChange}
                    required
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5
                      text-sm focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="" disabled>Select a group…</option>
                    {groups.map((g) => (
                      <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
                    ))}
                  </select>
                  {form.group_id && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      Task will be assigned to all members of this group.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Priority + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Priority</label>
              <select
                name="priority"
                value={form.priority}
                onChange={handleChange}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5
                  text-sm focus:outline-none focus:border-indigo-500 transition"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Due date</label>
              <input
                type="date"
                name="due_date"
                value={form.due_date}
                onChange={handleChange}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5
                  text-sm focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm
                font-medium rounded-xl py-2.5 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl py-2.5 transition"
            >
              {submitting
                ? 'Assigning…'
                : isGroupMode
                ? 'Assign to Group'
                : 'Assign Task'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
