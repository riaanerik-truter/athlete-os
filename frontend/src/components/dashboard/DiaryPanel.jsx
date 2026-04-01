import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useFetch } from '../../hooks/useApi.js'

function EntryRow({ entry }) {
  const [expanded, setExpanded] = useState(false)

  const date = entry.entry_date
    ? new Date(entry.entry_date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
    : '—'

  const hasDetail = entry.coach_summary || entry.session_reflection || entry.daily_notes

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0 py-3">
      <button
        className="w-full flex items-start gap-2 text-left group"
        onClick={() => hasDetail && setExpanded(e => !e)}
        disabled={!hasDetail}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{date}</span>
            {entry.rpe_overall != null && (
              <span className="text-xs text-gray-400">RPE {entry.rpe_overall}</span>
            )}
            {entry.wellness_score != null && (
              <span className="text-xs text-gray-400">Wellness {entry.wellness_score}/10</span>
            )}
          </div>

          {entry.coach_summary ? (
            <p className={`text-xs text-gray-600 dark:text-gray-300 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
              {entry.coach_summary}
            </p>
          ) : entry.session_reflection ? (
            <p className={`text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
              {entry.session_reflection}
            </p>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No notes recorded</p>
          )}
        </div>

        {hasDetail && (
          <span className="shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 mt-0.5">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        )}
      </button>

      {expanded && hasDetail && (
        <div className="mt-2 pl-0 space-y-2 text-xs text-gray-600 dark:text-gray-300">
          {entry.coach_summary && entry.session_reflection && (
            <p className="italic text-gray-500 dark:text-gray-400 leading-relaxed">
              {entry.session_reflection}
            </p>
          )}
          {entry.daily_notes && (
            <p className="leading-relaxed">{entry.daily_notes}</p>
          )}
          {entry.soreness_score != null && (
            <p className="text-gray-400">Soreness: {entry.soreness_score}/10</p>
          )}
          {entry.sleep_quality != null && (
            <p className="text-gray-400">Sleep quality: {entry.sleep_quality}/10</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function DiaryPanel() {
  const { data: res, loading, error } = useFetch('/diary?limit=3')
  const entries = Array.isArray(res) ? res : (res?.data ?? [])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Recent Diary</h2>

      {loading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
      {error   && <p className="text-sm text-red-500 py-4 text-center">Could not load diary</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-2">
          No diary entries yet — the coach adds summaries after sessions.
        </p>
      )}

      {!loading && !error && entries.map(e => (
        <EntryRow key={e.id ?? e.entry_date} entry={e} />
      ))}
    </div>
  )
}
