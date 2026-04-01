import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext.jsx'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="p-2 rounded-md text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
    >
      {theme === 'dark'
        ? <Sun className="w-5 h-5" />
        : <Moon className="w-5 h-5" />
      }
    </button>
  )
}
