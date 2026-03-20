import { useNavigate, Link } from 'react-router-dom'
import { Mic, LogOut, Users } from 'lucide-react'

export default function Navbar({ userName }) {
  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem('user_id')
    localStorage.removeItem('name')
    navigate('/login')
  }

  return (
    <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Mic className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-lg">VoiceTask</span>
        </Link>
        <Link
          to="/groups"
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
        >
          <Users className="w-4 h-4" />
          <span className="hidden sm:block">Groups</span>
        </Link>
      </div>
      <div className="flex items-center gap-4">
        {userName && (
          <span className="text-slate-400 text-sm hidden sm:block">{userName}</span>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white
            border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          Logout
        </button>
      </div>
    </nav>
  )
}
