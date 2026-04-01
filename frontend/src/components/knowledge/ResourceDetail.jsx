import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Tag, X } from 'lucide-react'
import { useFetch, useApi } from '../../hooks/useApi.js'
import EvidenceBadge from './EvidenceBadge.jsx'
import StatusBadge   from './StatusBadge.jsx'
import { formatDate } from '../../utils/formatters.js'

const STATUSES = ['queued', 'in_progress', 'done', 'for_revision']
const TABS     = ['Content', 'My Notes', 'Coach Summary', 'Coach Instructions']

// ---------------------------------------------------------------------------
// Tag editor
// ---------------------------------------------------------------------------

function TagEditor({ tags = [], onChange }) {
  const [input, setInput] = useState('')

  function add() {
    const t = input.trim().toLowerCase()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setInput('')
  }

  function remove(t) {
    onChange(tags.filter(x => x !== t))
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map(t => (
        <span key={t} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          {t}
          <button onClick={() => remove(t)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        placeholder="+ add tag"
        className="text-xs border-0 outline-none bg-transparent text-gray-600 dark:text-gray-300 placeholder-gray-400 w-20"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function ContentTab({ resource }) {
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2 text-sm">
        {resource.source_url && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Source URL</p>
            <a href={resource.source_url} target="_blank" rel="noreferrer"
              className="text-accent dark:text-accent-dark hover:underline break-all text-xs">{resource.source_url}</a>
          </div>
        )}
        {resource.word_count != null && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{resource.word_count.toLocaleString()} words</p>
        )}
        {resource.chunk_count != null && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{resource.chunk_count} chunks indexed for AI search</p>
        )}
        {resource.ingested_at && (
          <p className="text-xs text-gray-400">Ingested {formatDate(resource.ingested_at)}</p>
        )}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Content is chunked and indexed for semantic search. Use the chat widget to ask the coach questions referencing this resource.
      </p>
    </div>
  )
}

function NotesTab({ resourceId, initial, onSave }) {
  const [notes,   setNotes]   = useState(initial ?? '')
  const [saved,   setSaved]   = useState(false)
  const { request, loading }  = useApi()

  async function save() {
    const result = await request('PATCH', `/knowledge/resources/${resourceId}`, { user_notes: notes })
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 2000); onSave?.(notes) }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setSaved(false) }}
        placeholder="Your thoughts, highlights, questions about this resource…"
        rows={10}
        className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
      />
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={loading}
          className="text-sm px-4 py-1.5 rounded-lg bg-accent dark:bg-accent-dark text-white hover:opacity-90 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save notes'}
        </button>
        {saved && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
      </div>
    </div>
  )
}

function SummaryTab({ resourceId, resource, onRequest }) {
  const { request, loading } = useApi()
  const [requested, setRequested] = useState(!!resource.coach_summary_requested_at)

  async function requestSummary() {
    await request('POST', `/knowledge/resources/${resourceId}/summary`)
    setRequested(true)
    onRequest?.()
  }

  if (resource.coach_summary) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 leading-relaxed text-sm whitespace-pre-wrap">
        {resource.coach_summary}
      </div>
    )
  }

  return (
    <div className="text-center py-8 space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">No coach summary yet.</p>
      {requested ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">Summary requested — the knowledge engine will generate it within a few minutes.</p>
      ) : (
        <button onClick={requestSummary} disabled={loading}
          className="text-sm px-4 py-2 rounded-xl bg-accent dark:bg-accent-dark text-white hover:opacity-90 disabled:opacity-50">
          {loading ? 'Requesting…' : 'Request coach summary'}
        </button>
      )}
    </div>
  )
}

function InstructionsTab({ resourceId, resource, onRequest }) {
  const { request, loading } = useApi()
  const [instructions, setInstructions] = useState(resource.coach_instructions ?? '')
  const [requested, setRequested]       = useState(!!resource.coach_instructions_requested_at)
  const [saved, setSaved]               = useState(false)

  async function requestInstructions() {
    await request('POST', `/knowledge/resources/${resourceId}/instruct`)
    setRequested(true)
    onRequest?.()
  }

  async function saveManual() {
    const result = await request('PATCH', `/knowledge/resources/${resourceId}`, { coach_instructions: instructions })
    if (result) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <div className="space-y-4">
      {!resource.coach_instructions && !requested && (
        <button onClick={requestInstructions} disabled={loading}
          className="text-sm px-4 py-2 rounded-xl bg-accent dark:bg-accent-dark text-white hover:opacity-90 disabled:opacity-50">
          {loading ? 'Requesting…' : 'Request AI coach instructions'}
        </button>
      )}
      {requested && !resource.coach_instructions && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Instructions requested — being generated for your current training context.</p>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500">Or write your own instructions for how the coach should use this resource:</p>
      <textarea
        value={instructions}
        onChange={e => { setInstructions(e.target.value); setSaved(false) }}
        rows={8}
        placeholder="e.g. When I ask about threshold intervals, reference the Coggan zones from this book…"
        className="w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
      />
      <div className="flex items-center gap-3">
        <button onClick={saveManual} disabled={loading || !instructions.trim()}
          className="text-sm px-4 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
          {loading ? 'Saving…' : 'Save instructions'}
        </button>
        {saved && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResourceDetail() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const [activeTab, setActiveTab] = useState(0)

  const { data: resource, loading, error, reload } = useFetch(`/knowledge/resources/${id}`)
  const { request: patchResource } = useApi()

  const [localTags,   setLocalTags]   = useState(null)
  const [savingTags,  setSavingTags]  = useState(false)

  const tags = localTags ?? resource?.topic_tags ?? []

  async function updateStatus(status) {
    await patchResource('PATCH', `/knowledge/resources/${id}`, { status })
    reload()
  }

  async function saveTags(newTags) {
    setLocalTags(newTags)
    setSavingTags(true)
    await patchResource('PATCH', `/knowledge/resources/${id}`, { topic_tags: newTags })
    setSavingTags(false)
  }

  if (loading) {
    return (
      <main className="max-w-screen-md mx-auto px-4 py-8">
        <p className="text-gray-400">Loading…</p>
      </main>
    )
  }

  if (error || !resource) {
    return (
      <main className="max-w-screen-md mx-auto px-4 py-8">
        <button onClick={() => navigate('/knowledge')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>
        <p className="text-red-500 text-sm">{error ?? 'Resource not found'}</p>
      </main>
    )
  }

  return (
    <main className="max-w-screen-md mx-auto px-4 py-6">
      {/* Back */}
      <button onClick={() => navigate('/knowledge')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to library
      </button>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{resource.title}</h1>
        {resource.author && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{resource.author}</p>
        )}

        <div className="flex items-center flex-wrap gap-2 mt-3">
          <EvidenceBadge level={resource.evidence_level} />
          {/* Clickable status pills */}
          {STATUSES.map(s => (
            <button key={s} onClick={() => updateStatus(s)}>
              <StatusBadge
                status={s}
                onClick={() => {}}
              />
            </button>
          ))}
        </div>

        {/* Current status clearly highlighted */}
        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
          <span>Current status:</span>
          <StatusBadge status={resource.status} />
        </div>
      </div>

      {/* Tags */}
      <div className="mb-5 flex items-start gap-2">
        <Tag className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
        <TagEditor tags={tags} onChange={saveTags} />
        {savingTags && <span className="text-xs text-gray-400">Saving…</span>}
      </div>

      <hr className="border-gray-200 dark:border-gray-700 mb-5" />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i
                ? 'border-accent dark:border-accent-dark text-accent dark:text-accent-dark'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 0 && <ContentTab resource={resource} />}
        {activeTab === 1 && <NotesTab resourceId={id} initial={resource.user_notes} />}
        {activeTab === 2 && <SummaryTab resourceId={id} resource={resource} onRequest={reload} />}
        {activeTab === 3 && <InstructionsTab resourceId={id} resource={resource} onRequest={reload} />}
      </div>
    </main>
  )
}
