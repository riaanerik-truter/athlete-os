import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Settings, Menu, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle.jsx'

const NAV_LINKS = [
  { to: '/',           label: 'Dashboard' },
  { to: '/knowledge',  label: 'Knowledge' },
  { to: '/profile',    label: 'Profile'   },
]

// Active link style — underline with accent colour
function navLinkClass({ isActive }) {
  const base = 'text-sm font-medium px-1 py-0.5 transition-colors'
  return isActive
    ? `${base} text-accent dark:text-accent-dark border-b-2 border-accent dark:border-accent-dark`
    : `${base} text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border-b-2 border-transparent`
}

export default function Navbar({ onSettingsOpen }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20">
      <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

        {/* Logo */}
        <NavLink
          to="/"
          className="flex items-center gap-2 shrink-0"
          onClick={() => setMobileOpen(false)}
        >
          <span className="font-bold text-gray-900 dark:text-gray-100 tracking-tight">Athlete OS</span>
        </NavLink>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={navLinkClass}
              data-tour={to === '/knowledge' ? 'nav-knowledge' : undefined}
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1">
          <ThemeToggle />

          <button
            onClick={onSettingsOpen}
            aria-label="Open settings"
            data-tour="nav-settings"
            className="p-2 rounded-md text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle menu"
            className="md:hidden p-2 rounded-md text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 flex flex-col gap-3">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={navLinkClass}
              onClick={() => setMobileOpen(false)}
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}
