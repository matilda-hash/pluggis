import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, BookOpen, Upload, Stethoscope, Calendar, FileText, Settings2 } from 'lucide-react'

const navItems = [
  { to: '/',          icon: LayoutDashboard, label: 'Översikt',    end: true  },
  { to: '/study',     icon: BookOpen,         label: 'Studera',     end: false },
  { to: '/schedule',  icon: Calendar,         label: 'Schema',      end: false },
  { to: '/upload',    icon: Upload,           label: 'Ladda upp',   end: false },
  { to: '/documents', icon: FileText,         label: 'Dokument',    end: false },
  { to: '/settings',  icon: Settings2,        label: 'Inställningar', end: false },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="bg-primary-600 text-white p-1.5 rounded-lg">
                <Stethoscope size={18} />
              </div>
              <span className="font-bold text-gray-900 text-lg tracking-tight">Doktorn</span>
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
