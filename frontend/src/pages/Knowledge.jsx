import { useState } from 'react'
import { Plus, Search, Lightbulb } from 'lucide-react'
import ResourceList   from '../components/knowledge/ResourceList.jsx'
import DiscoverPanel  from '../components/knowledge/DiscoverPanel.jsx'

export default function Knowledge() {
  const [discoverMode, setDiscoverMode] = useState(null)  // null | 'A' | 'B' | 'C'
  const [reloadKey,    setReloadKey]    = useState(0)

  function closeDiscover() { setDiscoverMode(null) }
  function onCreated()     { setDiscoverMode(null); setReloadKey(k => k + 1) }

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Header + action buttons */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Knowledge Library</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDiscoverMode('A')}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-accent dark:bg-accent-dark text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add resource
          </button>
          <button
            onClick={() => setDiscoverMode('B')}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Search className="w-4 h-4" />
            Find resources
          </button>
          <button
            onClick={() => setDiscoverMode('C')}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Lightbulb className="w-4 h-4" />
            Explore
          </button>
        </div>
      </div>

      {/* Resource list with filter sidebar */}
      <ResourceList key={reloadKey} />

      {/* Discovery modals */}
      <DiscoverPanel mode={discoverMode} onClose={closeDiscover} onCreated={onCreated} />
    </main>
  )
}
