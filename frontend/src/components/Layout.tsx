import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Shield, Users, Activity, BarChart2, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/auth'

const navItems = [
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/sessions', icon: Activity, label: 'Sessions' },
  { to: '/stats', icon: BarChart2, label: 'Stats' },
]

export default function Layout() {
  const { adminUsername, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-800">
          <Shield className="text-blue-400" size={22} />
          <span className="font-bold text-lg tracking-tight">VPN Admin</span>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2 truncate">{adminUsername}</p>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-950">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
