import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, BookOpen, Upload, Calendar, FileText, Settings2, Globe, LogOut, Brain } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

const navItems = [
  { to: '/',             icon: LayoutDashboard, label: 'Översikt',      end: true  },
  { to: '/study',        icon: BookOpen,         label: 'Studera',       end: false },
  { to: '/ai-schedule',  icon: Brain,            label: 'AI-schema',     end: false },
  { to: '/schedule',     icon: Calendar,         label: 'Schema',        end: false },
  { to: '/upload',       icon: Upload,           label: 'Ladda upp',     end: false },
  { to: '/documents',    icon: FileText,         label: 'Dokument',      end: false },
  { to: '/public-decks', icon: Globe,            label: 'Dela',          end: false },
  { to: '/settings',     icon: Settings2,        label: 'Inställningar', end: false },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
            <div className="flex items-center">
              <img src="/pluggislogo.png" alt="Pluggis" className="h-11 w-auto" />
            </div>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              {navItems.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </nav>

            {/* User menu */}
            <div className="flex items-center gap-2">
              {user && (
                <span className="text-sm text-gray-500 hidden sm:block">
                  {user.name || user.email}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                title="Logga ut"
              >
                <LogOut size={15} />
                <span className="hidden sm:block">Logga ut</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
