import { useState } from 'react'
import { Info } from 'lucide-react'

/**
 * Props:
 *   title        string   — tooltip heading
 *   assumptions  string[] — "what we know / what was used"
 *   improvements string[] — "what would improve accuracy" (optional)
 *   note         string   — model/disclaimer note (optional)
 */
export default function InfoTooltip({ title, assumptions = [], improvements = [], note }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label="More information"
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <Info className="w-4 h-4" />
      </button>

      {visible && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 text-left">
          {title && (
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">{title}</p>
          )}

          {assumptions.length > 0 && (
            <ul className="space-y-1 mb-3">
              {assumptions.map((item, i) => (
                <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex gap-1">
                  <span className="text-gray-400 shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {improvements.length > 0 && (
            <>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">To improve accuracy, add:</p>
              <ul className="space-y-1 mb-3">
                {improvements.map((item, i) => (
                  <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex gap-1">
                    <span className="shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {note && (
            <p className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2 mt-1">{note}</p>
          )}

          {/* Caret */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white dark:border-t-gray-800" />
        </div>
      )}
    </div>
  )
}
