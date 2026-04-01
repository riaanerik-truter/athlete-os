const STATUS_STYLES = {
  queued:       'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  in_progress:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  done:         'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  for_revision: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  error:        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const STATUS_LABELS = {
  queued:       'Queued',
  in_progress:  'In progress',
  done:         'Done',
  for_revision: 'For revision',
  error:        'Error',
}

export default function StatusBadge({ status, onClick }) {
  if (!status) return null
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.queued
  return (
    <span
      className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${style} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      onClick={onClick}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
