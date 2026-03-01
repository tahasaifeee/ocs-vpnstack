import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Shield, Users, Activity, BarChart2, Settings, LogOut,
  UsersRound, Network, FileText, TrendingUp, Sliders, Server,
  ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'

const NAV_GROUPS = [
  {
    label: 'Management',
    items: [
      { to: '/users',  icon: Users,      label: 'Users' },
      { to: '/groups', icon: UsersRound, label: 'Groups' },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { to: '/sessions', icon: Activity,   label: 'Sessions' },
      { to: '/stats',    icon: BarChart2,  label: 'Statistics' },
      { to: '/node',     icon: Server,     label: 'Node' },
      { to: '/logs',     icon: FileText,   label: 'Logs' },
      { to: '/reports',  icon: TrendingUp, label: 'Reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/network', icon: Network, label: 'Network' },
      { to: '/service', icon: Sliders, label: 'Service' },
    ],
  },
]

export default function Layout() {
  const { adminUsername, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = adminUsername ? adminUsername.slice(0, 2).toUpperCase() : '?'

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col bg-[#0c1018] border-r border-white/[0.06]">

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-[58px] border-b border-white/[0.06] flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/60 flex-shrink-0">
            <Shield size={15} className="text-white" />
          </div>
          <div className="leading-tight min-w-0">
            <p className="text-[13px] font-bold tracking-tight truncate">VPN Admin</p>
            <p className="text-[10px] text-gray-600 truncate">Management Portal</p>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4 scrollbar-thin">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-700 px-3 mb-1">
                {group.label}
              </p>
              <div className="space-y-px">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-blue-500/[0.12] text-blue-300 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
                          : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.05]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={14}
                          className={`flex-shrink-0 transition-colors ${
                            isActive ? 'text-blue-400' : 'text-gray-600 group-hover:text-gray-400'
                          }`}
                        />
                        <span className="flex-1 truncate">{label}</span>
                        {isActive && (
                          <ChevronRight size={11} className="flex-shrink-0 text-blue-500/40" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom: settings + user row */}
        <div className="flex-shrink-0 border-t border-white/[0.06] px-2 py-3 space-y-px">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-blue-500/[0.12] text-blue-300 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.05]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Settings
                  size={14}
                  className={`flex-shrink-0 transition-colors ${
                    isActive ? 'text-blue-400' : 'text-gray-600 group-hover:text-gray-400'
                  }`}
                />
                <span className="flex-1">Settings</span>
                {isActive && <ChevronRight size={11} className="flex-shrink-0 text-blue-500/40" />}
              </>
            )}
          </NavLink>

          {/* User identity */}
          <div className="flex items-center gap-2.5 px-3 py-2 mt-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {initials}
            </div>
            <p className="flex-1 text-[12px] font-medium text-gray-400 truncate min-w-0">
              {adminUsername}
            </p>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="flex-shrink-0 text-gray-700 hover:text-red-400 transition-colors"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Thin top bar — visual separator + future global actions */}
        <header className="flex-shrink-0 h-[58px] bg-gray-950/60 border-b border-white/[0.05] backdrop-blur-sm" />

        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto px-6 py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
