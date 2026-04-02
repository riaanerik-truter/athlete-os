import { useState } from 'react'
import { Bug, X } from 'lucide-react'
import axios from 'axios'
import { API_KEY } from '../../config.js'

const API_HEADERS = { 'X-API-Key': API_KEY }

export default function BugReporter() {
  const [open,        setOpen]        = useState(false)
  const [description, setDescription] = useState('')
  const [submitted,   setSubmitted]   = useState(false)
  const [submitting,  setSubmitting]  = useState(false)

  function handleOpen() {
    setOpen(true)
    setSubmitted(false)
    setDescription('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!description.trim()) return
    setSubmitting(true)
    try {
      await axios.post(
        '/api/v1/bugs',
        {
          description: description.trim(),
          page:        window.location.pathname,
          timestamp:   new Date().toISOString(),
          userAgent:   navigator.userAgent,
        },
        { headers: API_HEADERS }
      )
      setSubmitted(true)
      setDescription('')
      setTimeout(() => setOpen(false), 1800)
    } catch {
      // Non-critical — just close
      setSubmitted(true)
      setTimeout(() => setOpen(false), 1800)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Fixed trigger button — bottom-left, above any other fixed UI */}
      <button
        onClick={handleOpen}
        className="fixed bottom-6 left-6 z-50 w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center justify-center shadow"
        title="Report a bug or idea"
        aria-label="Report a bug or idea"
      >
        <Bug className="w-4 h-4" />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Report a bug or idea</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {submitted ? (
              <p className="text-sm text-green-600 dark:text-green-400 py-4 text-center">
                Logged. Thanks.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe the issue or idea…"
                  rows={4}
                  className="w-full text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  autoFocus
                />

                <div className="text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
                  <p>Page: <span className="font-mono">{window.location.pathname}</span></p>
                  <p>Time: <span className="font-mono">{new Date().toLocaleString('en-ZA')}</span></p>
                </div>

                <button
                  type="submit"
                  disabled={!description.trim() || submitting}
                  className="w-full py-2 rounded-lg bg-accent dark:bg-accent-dark text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {submitting ? 'Logging…' : 'Submit'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
