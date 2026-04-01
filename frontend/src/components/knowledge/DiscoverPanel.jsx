// Three discovery paths (A, B, C) implemented as modals.
// Path A — add resource (URL / text paste)
// Path B — find resources (topic search)
// Path C — explore topics (AI-suggested)

import { useState } from 'react'
import { X, Upload, Search, Lightbulb } from 'lucide-react'
import { useApi, useFetch } from '../../hooks/useApi.js'

function Modal({ title, icon: Icon, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

const SOURCE_TYPES  = ['book', 'paper', 'article', 'video', 'podcast', 'course']
const EVIDENCE_OPTS = [
  { value: 'evidence_based', label: 'Evidence-based' },
  { value: 'practitioner',   label: 'Practitioner'   },
  { value: 'anecdotal',      label: 'Anecdotal'       },
]

// ---------------------------------------------------------------------------
// Path A — Add resource
// ---------------------------------------------------------------------------

function PathAModal({ onClose, onCreated }) {
  const { request, loading, error } = useApi()
  const [tab,          setTab]    = useState('url')  // 'url' | 'text'
  const [url,          setUrl]    = useState('')
  const [text,         setText]   = useState('')
  const [title,        setTitle]  = useState('')
  const [author,       setAuthor] = useState('')
  const [sourceType,   setST]     = useState('article')
  const [evidenceLevel, setEL]    = useState('practitioner')
  const [success,      setSuccess] = useState(false)

  async function submit() {
    const payload = {
      title:          title || (tab === 'url' ? url : 'Text resource'),
      source_type:    sourceType,
      evidence_level: evidenceLevel,
      ...(author && { author }),
      ...(tab === 'url' && url  && { source_url: url }),
      ...(tab === 'text' && text && { raw_text: text }),
    }
    const result = await request('POST', '/knowledge/resources', payload)
    if (result) { setSuccess(true); setTimeout(() => { onCreated?.(); onClose() }, 1000) }
  }

  const inputClass = 'w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal title="Add resource" icon={Upload} onClose={onClose}>
      {success && <p className="text-sm text-green-600 dark:text-green-400 mb-3">✓ Resource added — knowledge engine will process it</p>}
      {error   && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {/* Tab */}
      <div className="flex gap-2 mb-4">
        {['url', 'text'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium ${tab === t ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {t === 'url' ? 'URL' : 'Paste text'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab === 'url' ? (
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className={inputClass} />
        ) : (
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste article text here…" rows={5} className={inputClass} />
        )}

        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" className={inputClass} />
        <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author (optional)" className={inputClass} />

        <div className="flex gap-2">
          <select value={sourceType} onChange={e => setST(e.target.value)} className={`flex-1 ${inputClass}`}>
            {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={evidenceLevel} onChange={e => setEL(e.target.value)} className={`flex-1 ${inputClass}`}>
            {EVIDENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <p className="text-xs text-gray-400">To add a PDF file, send it via the chat widget — the coach will handle ingestion.</p>

        <button onClick={submit} disabled={loading || (!url && !text)}
          className="w-full py-2.5 rounded-xl bg-accent dark:bg-accent-dark text-white font-medium text-sm hover:opacity-90 disabled:opacity-50">
          {loading ? 'Adding…' : 'Add resource'}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Path B — Find resources
// ---------------------------------------------------------------------------

function PathBModal({ onClose, onCreated }) {
  const { request, loading, error } = useApi()
  const [topic,  setTopic] = useState('')
  const [el,     setEl]    = useState('practitioner')
  const [queued, setQueued] = useState(false)

  async function submit() {
    const result = await request('POST', '/knowledge/discover', { topic, evidence_level: el })
    if (result) setQueued(true)
  }

  const inputClass = 'w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal title="Find resources" icon={Search} onClose={onClose}>
      {queued ? (
        <div className="text-center py-4">
          <p className="text-sm font-medium text-green-600 dark:text-green-400">Discovery queued</p>
          <p className="text-xs text-gray-400 mt-1">The knowledge engine will find and add resources. Check back in a few minutes.</p>
          <button onClick={onClose} className="mt-4 text-sm text-accent dark:text-accent-dark hover:underline">Close</button>
        </div>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. heat acclimatisation for cycling" className={inputClass} />
          <select value={el} onChange={e => setEl(e.target.value)} className={inputClass}>
            {EVIDENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-xs text-gray-400 dark:text-gray-500">The knowledge engine searches for relevant papers, articles, and books matching your topic.</p>
          <button onClick={submit} disabled={loading || !topic.trim()}
            className="w-full py-2.5 rounded-xl bg-accent dark:bg-accent-dark text-white font-medium text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? 'Queuing…' : 'Find resources'}
          </button>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Path C — Explore topics
// ---------------------------------------------------------------------------

function PathCModal({ onClose, onCreated }) {
  const { data: topics, loading } = useFetch('/knowledge/topics')
  const { request, loading: discovering } = useApi()
  const [queued, setQueued] = useState(null)

  const topicList = Array.isArray(topics) ? topics : []

  async function discover(topic) {
    await request('POST', '/knowledge/discover', { topic, evidence_level: 'practitioner' })
    setQueued(topic)
  }

  // Placeholder topics if engine hasn't generated any yet
  const displayTopics = topicList.length > 0 ? topicList : [
    'Aerobic base development',
    'FTP testing protocols',
    'Heat adaptation for cycling',
    'Altitude training effects',
    'Periodisation for masters athletes',
  ]

  return (
    <Modal title="Explore topics" icon={Lightbulb} onClose={onClose}>
      {loading && <p className="text-sm text-gray-400 text-center py-4">Loading suggestions…</p>}

      {queued ? (
        <div className="text-center py-4">
          <p className="text-sm font-medium text-green-600 dark:text-green-400">Discovery queued for: {queued}</p>
          <button onClick={onClose} className="mt-3 text-sm text-accent dark:text-accent-dark hover:underline">Close</button>
        </div>
      ) : (
        <>
          {topicList.length === 0 && !loading && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              The knowledge engine generates personalised topic suggestions daily at 08:00. Showing example topics:
            </p>
          )}
          <div className="space-y-2">
            {displayTopics.map((topic, i) => {
              const name = typeof topic === 'string' ? topic : topic.name
              return (
                <button key={i} onClick={() => discover(name)} disabled={discovering}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-accent dark:hover:border-accent-dark hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{name}</p>
                  {typeof topic === 'object' && topic.reason && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{topic.reason}</p>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default function DiscoverPanel({ mode, onClose, onCreated }) {
  if (!mode) return null
  if (mode === 'A') return <PathAModal onClose={onClose} onCreated={onCreated} />
  if (mode === 'B') return <PathBModal onClose={onClose} onCreated={onCreated} />
  if (mode === 'C') return <PathCModal onClose={onClose} onCreated={onCreated} />
  return null
}
