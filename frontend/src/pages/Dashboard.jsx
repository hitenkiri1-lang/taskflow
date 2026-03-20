import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import Navbar from '../components/Navbar'
import VoiceButton from '../components/VoiceButton'
import StatsBar from '../components/StatsBar'
import TaskSection from '../components/TaskSection'
import TaskForm from '../components/TaskForm'
import axios from '../api/axios'

// Normalise a Firestore doc into a plain task object
function docToTask(doc) {
  const d = doc.data()
  return {
    task_id:       doc.id,
    task_title:    d.task_title,
    task_number:   d.task_number,
    assignee_name: d.assignee_name ?? null,
    assigned_by:   d.assigned_by ?? null,
    sender_id:     d.sender_id ?? null,
    priority:      d.priority,
    due_date:      d.due_date ?? null,
    status:        d.status,
    transcript:    d.transcript,
    group_id:      d.group_id ?? null,
    group_name:    d.group_name ?? null,
    created_at:    d.created_at?.toDate?.()?.toISOString() ?? d.created_at ?? null,
  }
}

export default function Dashboard() {
  const userId = localStorage.getItem('user_id')
  const name   = localStorage.getItem('name')

  const [toMe,   setToMe]   = useState([])
  const [byMe,   setByMe]   = useState([])
  const [groupTasks, setGroupTasks] = useState([])
  const [loadingToMe, setLoadingToMe] = useState(true)
  const [loadingByMe, setLoadingByMe] = useState(true)
  const [loadingGroup, setLoadingGroup] = useState(true)
  const [toast,  setToast]  = useState(null)
  const [showTaskForm, setShowTaskForm] = useState(false)

  // ── Listener 1: tasks assigned TO the logged-in user ─────────────────────
  useEffect(() => {
    if (!name) return

    const nameLower = name.toLowerCase()
    console.log('[Dashboard] Starting toMe listener for assignee_name ==', nameLower)

    // NOTE: this query requires a composite index on (assignee_name ASC, task_number ASC).
    // If the index doesn't exist yet, Firestore will reject it and log a link in the
    // browser console — click that link to create the index, then reload.
    // While the index is being built, we fall back to a simple single-field query
    // and sort client-side so tasks still appear immediately.
    const q = query(
      collection(db, 'tasks'),
      where('assignee_name', '==', nameLower),
      orderBy('task_number', 'asc'),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const tasks = snap.docs.map(docToTask)
        // Client-side sort as a safety net in case index isn't ready yet
        tasks.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
        console.log('[Dashboard] toMe tasks loaded:', tasks.length, tasks)
        setToMe(tasks)
        setLoadingToMe(false)
      },
      (err) => {
        console.error('[Dashboard] toMe listener error:', err.code, err.message)
        // If the composite index is missing, Firestore returns "failed-precondition"
        // and logs a direct URL to create it. Fall back to a simpler query.
        if (err.code === 'failed-precondition') {
          console.warn('[Dashboard] Composite index missing — falling back to unordered query. Check the console link above to create the index.')
          const fallbackQ = query(
            collection(db, 'tasks'),
            where('assignee_name', '==', nameLower),
          )
          // One-time fallback subscription
          const fallbackUnsub = onSnapshot(fallbackQ, (snap) => {
            const tasks = snap.docs.map(docToTask)
            tasks.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
            console.log('[Dashboard] toMe tasks (fallback):', tasks.length, tasks)
            setToMe(tasks)
            setLoadingToMe(false)
          })
          // Store fallback unsub so cleanup still works
          return fallbackUnsub
        }
        setToast({ type: 'error', message: `Firestore error: ${err.message}` })
        setLoadingToMe(false)
      },
    )
    return () => unsub()
  }, [name])

  // ── Listener 2: tasks assigned BY the logged-in user ─────────────────────
  useEffect(() => {
    if (!userId) return

    console.log('[Dashboard] Starting byMe listener for sender_id ==', userId)

    // Requires composite index on (sender_id ASC, task_number ASC)
    const q = query(
      collection(db, 'tasks'),
      where('sender_id', '==', userId),
      orderBy('task_number', 'asc'),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const tasks = snap.docs.map(docToTask)
        tasks.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
        console.log('[Dashboard] byMe tasks loaded:', tasks.length, tasks)
        setByMe(tasks)
        setLoadingByMe(false)
      },
      (err) => {
        console.error('[Dashboard] byMe listener error:', err.code, err.message)
        if (err.code === 'failed-precondition') {
          console.warn('[Dashboard] Composite index missing — falling back to unordered query.')
          const fallbackQ = query(
            collection(db, 'tasks'),
            where('sender_id', '==', userId),
          )
          const fallbackUnsub = onSnapshot(fallbackQ, (snap) => {
            const tasks = snap.docs.map(docToTask)
            tasks.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
            console.log('[Dashboard] byMe tasks (fallback):', tasks.length, tasks)
            setByMe(tasks)
            setLoadingByMe(false)
          })
          return fallbackUnsub
        }
        setToast({ type: 'error', message: `Firestore error: ${err.message}` })
        setLoadingByMe(false)
      },
    )
    return () => unsub()
  }, [userId])

  // ── Listener 3: group tasks for all groups the user belongs to ──────────
  useEffect(() => {
    if (!userId) return

    let unsubGroupTasks = null

    // First fetch the user's group IDs via REST, then set up Firestore listener
    axios.get('/groups')
      .then((res) => {
        const groups = res.data.groups || []
        const groupIds = groups.map((g) => g.group_id)

        if (groupIds.length === 0) {
          setGroupTasks([])
          setLoadingGroup(false)
          return
        }

        console.log('[Dashboard] Starting groupTasks listener for group_ids:', groupIds)

        // Firestore 'in' supports up to 30 values
        const q = query(
          collection(db, 'tasks'),
          where('group_id', 'in', groupIds.slice(0, 30)),
        )

        unsubGroupTasks = onSnapshot(
          q,
          (snap) => {
            // Only new-model docs: group_id present AND no assignee_name
            const tasks = snap.docs
              .map(docToTask)
              .filter((t) => t.group_id && !t.assignee_name)
            tasks.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
            console.log('[Dashboard] groupTasks loaded:', tasks.length)
            setGroupTasks(tasks)
            setLoadingGroup(false)
          },
          (err) => {
            console.error('[Dashboard] groupTasks listener error:', err.code, err.message)
            setLoadingGroup(false)
          },
        )
      })
      .catch((err) => {
        console.error('[Dashboard] Failed to fetch groups for listener:', err)
        setLoadingGroup(false)
      })

    return () => { unsubGroupTasks?.() }
  }, [userId])

  // ── Stats derived from both lists ─────────────────────────────────────────
  const stats = useMemo(() => {
    const all = [...toMe, ...byMe]
    // De-duplicate by task_id (a task assigned to yourself appears in both)
    const unique = Object.values(
      Object.fromEntries(all.map((t) => [t.task_id, t]))
    )
    return {
      assignedToMe: toMe.length,
      assignedByMe: byMe.length,
      pending:      unique.filter((t) => t.status === 'pending').length,
      inProgress:   unique.filter((t) => t.status === 'in-progress').length,
      completed:    unique.filter((t) => t.status === 'completed').length,
      groupTasks:   groupTasks.length,
    }
  }, [toMe, byMe, groupTasks])

  // ── Auto-dismiss toast ────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const handleVoiceResult = (result) => {
    const { action, success, task, message, updated_tasks, new_status, task_number, group_name, tasks_created } = result

    if (action === 'create_group_task' && success) {
      setToast({ type: 'success', message: `Created ${tasks_created} task(s) for group "${group_name}".` })
      return
    }
    if (action === 'leave_group' && success) {
      setToast({ type: 'success', message: `Left group "${result.group_name}".` })
      return
    }
    if (action === 'remove_member' && success) {
      setToast({ type: 'success', message: `Removed "${result.member_name}" from "${result.group_name}".` })
      return
    }
    if (action === 'approve_tasks') {
      setToast({ type: 'success', message: `Approved ${updated_tasks} task(s).` })
      return
    }
    if (action === 'update_task_status') {
      setToast({ type: 'success', message: `Task #${task_number} → ${new_status}` })
      return
    }
    if (action === 'create_task' && success) {
      setToast({
        type: 'success',
        message: `Task #${task.task_number} "${task.task_title}" → ${task.assignee_name}`,
      })
      return
    }
    // error fallback
    setToast({ type: 'error', message: message || 'Something went wrong.' })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar userName={name} />

      {/* Task form modal */}
      <AnimatePresence>
        {showTaskForm && (
          <TaskForm
            onClose={() => setShowTaskForm(false)}
            onSuccess={(data) => {
              setShowTaskForm(false)
              if (data.tasks_created) {
                setToast({ type: 'success', message: `${data.tasks_created} task(s) assigned to group "${data.group_name}".` })
              } else {
                setToast({ type: 'success', message: `Task #${data.task_number} assigned to ${data.task?.assignee_name}.` })
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Floating toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
            className={[
              'fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[92%]',
              'rounded-xl px-5 py-3.5 text-sm font-medium shadow-2xl border',
              'flex items-start gap-3',
              toast.type === 'success'
                ? 'bg-green-500/10 border-green-500/40 text-green-300'
                : 'bg-red-500/10 border-red-500/40 text-red-300',
            ].join(' ')}
          >
            <span>{toast.type === 'success' ? '✅' : '❌'}</span>
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-slate-500 hover:text-white transition" aria-label="Dismiss">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Greeting */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div>
            <p className="text-slate-400 text-sm">Welcome back</p>
            <p className="text-2xl font-bold mt-0.5">{name}</p>
          </div>
          <button
            onClick={() => setShowTaskForm(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
              text-white text-sm font-medium px-4 py-2 rounded-xl transition"
          >
            + Assign Task
          </button>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <StatsBar stats={stats} />
        </motion.div>

        {/* Voice button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-8"
        >
          <VoiceButton onResult={handleVoiceResult} />
        </motion.div>

        {/* Tasks assigned TO me */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <TaskSection
            title="Tasks Assigned To Me"
            tasks={toMe}
            loading={loadingToMe}
            showSender
          />
        </motion.div>

        {/* Divider */}
        <div className="border-t border-slate-800" />

        {/* Tasks assigned BY me */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <TaskSection
            title="Tasks Assigned By Me"
            tasks={byMe}
            loading={loadingByMe}
            showAssignee
          />
        </motion.div>

        {/* Divider */}
        <div className="border-t border-slate-800" />

        {/* Group tasks */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <TaskSection
            title="Group Tasks"
            tasks={groupTasks}
            loading={loadingGroup}
            showGroup
          />
        </motion.div>

      </main>
    </div>
  )
}
