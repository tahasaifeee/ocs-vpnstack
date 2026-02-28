import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Users from './pages/Users'
import Sessions from './pages/Sessions'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Groups from './pages/Groups'
import Network from './pages/Network'
import Logs from './pages/Logs'
import Reports from './pages/Reports'
import Service from './pages/Service'

/**
 * On every page load, if we have a refresh token but no access token (the
 * access token is intentionally not persisted), silently exchange the refresh
 * token for a new access token before any page queries fire.  This avoids the
 * "401 storm" where every query on the page independently races to refresh,
 * which can leave some queries in a permanent error / empty state.
 */
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const accessToken  = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const refresh      = useAuthStore((s) => s.refresh)
  const logout       = useAuthStore((s) => s.logout)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (accessToken) {
      // Already have a valid access token — nothing to do.
      setReady(true)
      return
    }
    if (!refreshToken) {
      // No session at all — go straight to login.
      setReady(true)
      return
    }
    // Have a refresh token but no access token (typical after a page reload).
    // Exchange it before any child queries fire.
    refresh()
      .catch(() => logout())
      .finally(() => setReady(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token   = useAuthStore((s) => s.accessToken)
  const refresh = useAuthStore((s) => s.refreshToken)
  if (!token && !refresh) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthBootstrap>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/users" replace />} />
          <Route path="users"    element={<Users />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="stats"    element={<Stats />} />
          <Route path="settings" element={<Settings />} />
          <Route path="groups"   element={<Groups />} />
          <Route path="network"  element={<Network />} />
          <Route path="logs"     element={<Logs />} />
          <Route path="reports"  element={<Reports />} />
          <Route path="service"  element={<Service />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthBootstrap>
  )
}
