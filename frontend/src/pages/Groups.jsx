import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from '../components/Navbar'
import axios from '../api/axios'

export default function Groups() {
  const userId = localStorage.getItem('user_id')
  const name   = localStorage.getItem('name')
  const navigate = useNavigate()

  const [groups,      setGroups]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [toast,       setToast]       = useState(null)
  const [createName,  setCreateName]  = useState('')
  const [joinId,      setJoinId]      = useState('')
  const [submitting,  setSubmitting]  = useState(false)

  const fetchGroups = async () => {
    try {
      const res = await axios.get('/groups')
      setGroups(res.data.groups || [])
    } catch (err) {
      showToast('error', err.response?.data?.detail || 'Failed to load groups.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGroups() }, [])

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 5000)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!createName.trim()) return
    setSubmitting(true)
    try {
      const res = await axios.post(
        '/groups/create',
        { group_name: createName.trim() },
      )
      showToast('success', `Group "${res.data.group_name}" created.`)
      setCreateName('')
      fetchGroups()
    } catch (err) {
      showToast('error', err.response?.data?.detail || 'Failed to create group.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!joinId.trim()) return
    setSubmitting(true)
    try {
      const res = await axios.post(
        '/groups/join',
        { group_id: joinId.trim() },
      )
      showToast('success', `Joined group "${res.data.group_name}".`)
      setJoinId('')
      fetchGroups()
    } catch (err) {
      showToast('error', err.response?.data?.detail || 'Failed to join group.')
    } finally {
      setSubmitting(false)
    }
  }

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

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => navigate('/dashboard')}
            className="text-slate-400 hover:text-white text-sm transition flex items-center gap-1 mb-4"
          >
            ← Dashboard
          </button>
          <p className="text-slate-400 text-sm">Manage your groups</p>
          <p className="text-2xl font-bold mt-0.5">Groups</p>
        </motion.div>

        {/* Create group */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
        >
          <p className="text-sm font-semibold text-slate-300">Create a new group</p>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Group name (e.g. Development Team)"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5
                text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={submitting || !createName.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                text-white text-sm font-medium px-5 py-2.5 rounded-xl transition"
            >
              Create
            </button>
          </form>
        </motion.div>

        {/* Join group */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
        >
          <p className="text-sm font-semibold text-slate-300">Join an existing group</p>
          <form onSubmit={handleJoin} className="flex gap-3">
            <input
              type="text"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="Group ID"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5
                text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={submitting || !joinId.trim()}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                text-white text-sm font-medium px-5 py-2.5 rounded-xl transition"
            >
              Join
            </button>
          </form>
        </motion.div>

        {/* Group list */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="space-y-3"
        >
          <p className="text-sm font-semibold text-slate-300">Your groups ({groups.length})</p>

          {loading && <p className="text-slate-500 text-sm">Loading…</p>}

          {!loading && groups.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500 text-sm">
              You're not in any groups yet.
            </div>
          )}

          {groups.map((g, i) => (
            <motion.div
              key={g.group_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => navigate(`/groups/${g.group_id}`)}
              className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-2
                hover:border-indigo-500/50 hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-cyan-400">👥</span>
                  <p className="font-medium text-white">{g.group_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">
                    {g.members?.length ?? 0} member{g.members?.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-slate-600 text-xs">→</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 font-mono">ID: {g.group_id}</p>
            </motion.div>
          ))}
        </motion.div>

      </main>
    </div>
  )
}
