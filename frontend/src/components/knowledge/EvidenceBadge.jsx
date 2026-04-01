const EVIDENCE_STYLES = {
  evidence_based: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  practitioner:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  anecdotal:      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

const EVIDENCE_LABELS = {
  evidence_based: 'Evidence-based',
  practitioner:   'Practitioner',
  anecdotal:      'Anecdotal',
}

export default function EvidenceBadge({ level }) {
  if (!level) return null
  const style = EVIDENCE_STYLES[level] ?? EVIDENCE_STYLES.anecdotal
  return (
    <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${style}`}>
      {EVIDENCE_LABELS[level] ?? level}
    </span>
  )
}
