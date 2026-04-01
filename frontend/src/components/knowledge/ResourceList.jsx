import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useFetch } from '../../hooks/useApi.js'
import ResourceCard from './ResourceCard.jsx'

const STATUS_OPTIONS   = ['queued', 'in_progress', 'done', 'for_revision']
const EVIDENCE_OPTIONS = ['evidence_based', 'practitioner', 'anecdotal']
const SPORT_OPTIONS    = ['cycling', 'running', 'swimming', 'triathlon', 'strength']

const STATUS_LABELS = {
  queued: 'Queued', in_progress: 'In progress', done: 'Done', for_revision: 'For revision',
}
const EVIDENCE_LABELS = {
  evidence_based: 'Evidence-based', practitioner: 'Practitioner', anecdotal: 'Anecdotal',
}

function FilterGroup({ title, options, labels, selected, onChange }) {
  const [open, setOpen] = useState(true)
  function toggle(v) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }
  return (
    <div className="border-b border-gray-100 dark:border-gray-700 pb-3 mb-3 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2"
      >
        {title}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="space-y-1.5">
          {options.map(v => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(v)}
                onChange={() => toggle(v)}
                className="accent-accent w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">
                {(labels ?? {})[v] ?? v}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ResourceList({ onReload }) {
  const [statusFilter,   setStatusFilter]   = useState([])
  const [evidenceFilter, setEvidenceFilter] = useState([])
  const [sportFilter,    setSportFilter]    = useState([])
  const [offset,         setOffset]         = useState(0)
  const [sidebarOpen,    setSidebarOpen]    = useState(true)

  const LIMIT = 20

  // Build query string
  const params = new URLSearchParams()
  if (statusFilter.length === 1)   params.set('status',         statusFilter[0])
  if (evidenceFilter.length === 1) params.set('evidence_level',  evidenceFilter[0])
  if (sportFilter.length === 1)    params.set('sport_tag',       sportFilter[0])
  params.set('limit',  LIMIT)
  params.set('offset', offset)

  const { data: res, loading, error, reload } = useFetch(`/knowledge/resources?${params}`)
  const resources = Array.isArray(res) ? res : (res?.data ?? [])
  const total     = res?.total ?? resources.length

  function resetFilters() {
    setStatusFilter([])
    setEvidenceFilter([])
    setSportFilter([])
    setOffset(0)
  }

  const hasFilters = statusFilter.length || evidenceFilter.length || sportFilter.length

  return (
    <div className="flex gap-5">
      {/* Sidebar */}
      <aside className={`shrink-0 ${sidebarOpen ? 'w-44' : 'w-0 overflow-hidden'} transition-all`}>
        <div className="sticky top-20 space-y-0">
          <FilterGroup title="Status"   options={STATUS_OPTIONS}   labels={STATUS_LABELS}   selected={statusFilter}   onChange={v => { setStatusFilter(v); setOffset(0) }} />
          <FilterGroup title="Evidence" options={EVIDENCE_OPTIONS} labels={EVIDENCE_LABELS} selected={evidenceFilter} onChange={v => { setEvidenceFilter(v); setOffset(0) }} />
          <FilterGroup title="Sport"    options={SPORT_OPTIONS}    selected={sportFilter}   onChange={v => { setSportFilter(v); setOffset(0) }} />
          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mt-2">
              Clear filters
            </button>
          )}
        </div>
      </aside>

      {/* List */}
      <div className="flex-1 min-w-0 space-y-3">
        {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>}
        {error   && <p className="text-sm text-red-500 py-6 text-center">Could not load resources</p>}

        {!loading && !error && resources.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-gray-500 dark:text-gray-400">No resources found</p>
            {hasFilters && (
              <button onClick={resetFilters} className="text-xs text-accent dark:text-accent-dark hover:underline mt-2">
                Clear filters
              </button>
            )}
          </div>
        )}

        {resources.map(r => <ResourceCard key={r.id} resource={r} />)}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-gray-400">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <div className="flex gap-2">
              <button disabled={offset === 0} onClick={() => setOffset(o => o - LIMIT)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-300">
                Previous
              </button>
              <button disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-gray-700 dark:text-gray-300">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
