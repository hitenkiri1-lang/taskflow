import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import Navbar from '../components/Navbar'
import TaskCard from '../components/TaskCard'
import TaskForm from '../components/TaskForm'
import axios from '../api/axios'

const STATUS_STYLE = {
  pending:       'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  'in-progress': 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  completed:     'bg-green-500/15 text-green-400 border border-green-500/30',
  approved:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
}

const FILTERS = ['all', 'pending', 'in-progress', 'completed', 'approved']

const FILTER_STYLE = {
  active:   'bg-indigo-600 text-white',
  inactive: 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700',
}

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function GroupDetails() {
  const { groupId } = useParams()
  const navigate    = useNavigate()
  const userId      = localStorage.getItem('user_id')
  const name        = localStorage.getItem('name')

  const [group,        setGroup]        = useState(null)
  const [memberNames,  setMemberNames]  = useState({}) // uid → name
  const [tasks,        setTasks]        = useState([])
  const [loadingGroup, setLoadingGroup] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [filter,       setFilter]       = useState('all')
  const [error,        setError]        = useState(null)
  const [toast,        setToast]        = useState(null)
  const [actionUid,    setActionUid]    = useState(null)
  const [showTaskForm, setShowTaskForm] = useState(false)

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 5000)
  }

  const handleLeave = async () => {
    if (!window.confirm('Are you sure you want to leave this group?')) return
    try {
      await axios.post('/groups/leave', { group_id: groupId })
      navigate('/groups')
    } catch (err) {
      showToast('error', err.response?.data?.detail || 'Failed to leave group.')
    }
  }

  const handleRemoveMember = async (memberUid) => {
    const memberName = memberNames[memberUid] || memberUid
    if (!window.confirm(`Remove ${memberName} from this group?`)) return
    setActionUid(memberUid)
    try {
      await axios.post('/groups/remove-member', { group_id: groupId, member_id: memberUid })
      showToast('success', `${memberName} removed from group.`)
    } catch (err) {
      showToast('error', err.response?.data?.detail || 'Failed to remove member.')
    } finally {
      setActionUid(null)
    }
  }

  // ── Listener 1: group doc (members update in realtime) ───────────────────
  useEffect(() => {
    if (!groupId) return

    const unsub = onSnapshot(
      doc(db, 'groups', groupId),
      async (snap) => {
        if (!snap.exists()) {
          setError('Group not found.')
          setLoadingGroup(false)
          return
        }
        const data = snap.data()
        setGroup({ group_id: snap.id, ...data })
        setLoadingGroup(false)

        // Resolve member UIDs → names via users collection
        const members = data.members || []
        if (members.length === 0) { setMemberNames({}); return }

        // Fetch each user doc once (members list rarely exceeds dozens)
        const { getDocs, doc: fsDoc, getDoc } = await import('firebase/firestore')
        const resolved = {}
        await Promise.all(
          members.map(async (uid) => {
            try {
              const userSnap = await getDoc(fsDoc(db, 'users', uid))
              if (userSnap.exists()) {
                resolved[uid] = userSnap.data().name || uid
              } else {
                resolved[uid] = uid
              }
            } catch {
              resolved[uid] = uid
            }
          })
        )
        setMemberNames(resolved)
      },
      (err) => {
        console.error('[GroupDetails] group listener error:', err)
        setError('Failed to load group.')
        setLoadingGroup(false)
      },
    )

    return () => unsub()
  }, [groupId])

  // ── Listener 2: tasks for this group ─────────────────────────────────────
  useEffect(() => {
    if (!groupId) return

    const q = query(
      collection(db, 'tasks'),
      where('group_id', '==', groupId),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const t = d.data()
            return {
              task_id:       d.id,
              task_title:    t.task_title,
              task_number:   t.task_number,
              assignee_name: t.assignee_name ?? null,
              assigned_by:   t.assigned_by ?? null,
              priority:      t.priority,
              due_date:      t.due_date ?? null,
              status:        t.status,
              group_id:      t.group_id,
              group_name:    t.group_name,
            }
          })
          // Migration filter: only show new-model docs (no assignee_name)
          .filter((t) => !t.assignee_name)
        list.sort((a, b) => (a.task_number ?? 0) - (b.task_number ?? 0))
        console.log('[GroupDetails] tasks loaded:', list.length)
        setTasks(list)
        setLoadingTasks(false)
      },
      (err) => {
        console.error('[GroupDetails] tasks listener error:', err)
        setLoadingTasks(false)
      },
    )

    return () => unsub()
  }, [groupId])

  const visibleTasks = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)

  // ── Task status counts ────────────────────────────────────────────────────
  const counts = {
    pending:     tasks.filter((t) => t.status === 'pending').length,
    'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
    completed:   tasks.filter((t) => t.status === 'completed').length,
    approved:    tasks.filter((t) => t.status === 'approved').length,
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar userName={name} />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-red-400 text-lg">{error}</p>
          <button onClick={() => navigate('/groups')} className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm transition">
            ← Back to Groups
          </button>
        </div>
      </div>
    )
  }

  const isOwner  = group?.created_by === userId
  const isMember = group?.members?.includes(userId) && !isOwner

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar userName={name} />

      {/* Toast */}
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
            <button onClick={() => setToast(null)} className="text-slate-500 hover:text-white transition">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Task form modal — owner only */}
        <AnimatePresence>
          {showTaskForm && (
            <TaskForm
              forceGroup
              preselectedGroupId={groupId}
              preselectedGroupName={group?.group_name}
              onClose={() => setShowTaskForm(false)}
              onSuccess={(data) => {
                setShowTaskForm(false)
                showToast('success', `${data.tasks_created} task(s) assigned to group.`)
              }}
            />
          )}
        </AnimatePresence>

        {/* Back link */}
        <button
          onClick={() => navigate('/groups')}
          className="text-slate-400 hover:text-white text-sm transition flex items-center gap-1"
        >
          ← Back to Groups
        </button>

        {/* Header */}
        {loadingGroup ? (
          <div className="h-12 bg-slate-800 rounded-xl animate-pulse w-48" />
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">👥</span>
                <div>
                  <h1 className="text-2xl font-bold text-white">{group?.group_name}</h1>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {group?.members?.length ?? 0} member{group?.members?.length !== 1 ? 's' : ''}
                    {' · '}
                    <span className="inline-flex items-center gap-1 text-green-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Live
                    </span>
                  </p>
                </div>
              </div>
              {/* Leave button — only for non-owner members */}
              {isMember && (
                <button
                  onClick={handleLeave}
                  className="text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10
                    px-3 py-1.5 rounded-lg transition shrink-0"
                >
                  Leave Group
                </button>
              )}
              {/* Assign Task button — owner only */}
              {isOwner && (
                <button
                  onClick={() => setShowTaskForm(true)}
                  className="text-xs text-white bg-indigo-600 hover:bg-indigo-500
                    px-3 py-1.5 rounded-lg transition shrink-0"
                >
                  + Assign Task
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Task stat pills */}
        {!loadingTasks && tasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="flex flex-wrap gap-2"
          >
            {Object.entries(counts).map(([status, count]) => count > 0 && (
              <span
                key={status}
                className={`text-xs px-3 py-1 rounded-full border ${STATUS_STYLE[status] || ''}`}
              >
                {count} {status}
              </span>
            ))}
          </motion.div>
        )}

        {/* Members section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-300">Members</p>
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
              {group?.members?.length ?? 0}
            </span>
          </div>

          {loadingGroup ? (
            <div className="space-y-2">
              {[1, 2].map((n) => (
                <div key={n} className="h-9 bg-slate-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : group?.members?.length === 0 ? (
            <p className="text-slate-500 text-sm">No members yet.</p>
          ) : (
            <div className="space-y-2">
              {(group?.members || []).map((uid, i) => (
                <motion.div
                  key={uid}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-3 py-2"
                >
                  {/* Avatar initial */}
                  <div className="w-7 h-7 rounded-full bg-indigo-600/40 border border-indigo-500/30
                    flex items-center justify-center text-xs font-semibold text-indigo-300 shrink-0">
                    {(memberNames[uid] || uid).charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-white capitalize">
                    {memberNames[uid] || uid}
                  </span>
                  {uid === group?.created_by && (
                    <span className="ml-auto text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                      owner
                    </span>
                  )}
                  {/* Remove button — owner only, not for themselves */}
                  {isOwner && uid !== userId && (
                    <button
                      onClick={() => handleRemoveMember(uid)}
                      disabled={actionUid === uid}
                      className="ml-auto text-xs text-red-400 hover:text-red-300
                        disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      {actionUid === uid ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Group ID (for sharing) */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Group ID — share this so others can join</p>
            <p className="text-xs font-mono text-slate-300">{groupId}</p>
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(groupId)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition shrink-0"
          >
            Copy
          </button>
        </motion.div>

        {/* Tasks section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="space-y-4"
        >
          {/* Section header + filter */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">Group Tasks</p>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                {visibleTasks.length}
              </span>
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            </div>
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

          {loadingTasks && (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loadingTasks && visibleTasks.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500 text-sm">
              No {filter === 'all' ? '' : filter + ' '}tasks for this group yet.
            </div>
          )}

          <AnimatePresence>
            <div className="space-y-2.5">
              {visibleTasks.map((task, i) => (
                <TaskCard
                  key={task.task_id}
                  task={task}
                  index={i}
                  showAssignee
                  groupMembers={group?.members || []}
                  groupOwnerId={group?.created_by}
                />
              ))}
            </div>
          </AnimatePresence>
        </motion.div>

      </main>
    </div>
  )
}
