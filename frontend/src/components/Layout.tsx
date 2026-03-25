import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { BookOpen, Upload, Calendar, Settings2, LogOut, Brain, Menu, X, MessageCircle } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import PomodoroWidget from './PomodoroWidget'

const navItems = [
  { to: '/ai-schedule',  icon: Brain,            label: 'Schema',        end: false },
  { to: '/tutor',        icon: MessageCircle,    label: 'Handledare',    end: false },
  { to: '/study',        icon: BookOpen,         label: 'Studera',       end: false },
  { to: '/schedule',     icon: Calendar,         label: 'Kalender',      end: false },
  { to: '/upload',       icon: Upload,           label: 'Ladda upp',     end: false },
  { to: '/settings',     icon: Settings2,        label: 'Inställningar', end: false },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">

            {/* Logo */}
            <div className="flex items-center flex-shrink-0">
              <img src="/pluggislogo.png" alt="Pluggis" className="h-10 w-auto" />
            </div>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon size={15} />
                  <span className="hidden lg:block">{label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Right: user + logout (desktop) + hamburger (mobile) */}
            <div className="flex items-center gap-2">
              {user && (
                <span className="text-sm text-gray-500 hidden lg:block truncate max-w-32">
                  {user.name || user.email}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="hidden md:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                title="Logga ut"
              >
                <LogOut size={15} />
                <span className="hidden lg:block">Logga ut</span>
              </button>

              {/* Mobile hamburger */}
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                aria-label="Meny"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1 shadow-lg">
            {navItems.map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
            <div className="border-t border-gray-100 pt-2 mt-1">
              {user && (
                <p className="text-xs text-gray-400 px-4 pb-2 truncate">{user.name || user.email}</p>
              )}
              <button
                onClick={() => { setMenuOpen(false); handleLogout() }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <LogOut size={18} />
                Logga ut
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Outlet />
        </div>
      </main>

      {/* Floating Pomodoro timer */}
      <PomodoroWidget />
    </div>
  )
}
