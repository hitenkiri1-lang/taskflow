import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Register from './pages/Register'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Groups from './pages/Groups'
import GroupDetails from './pages/GroupDetails'

function ProtectedRoute({ children }) {
  return localStorage.getItem('user_id')
    ? children
    : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups"
            element={
              <ProtectedRoute>
                <Groups />
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups/:groupId"
            element={
              <ProtectedRoute>
                <GroupDetails />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </div>
  )
}
