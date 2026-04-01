import { useNavigate } from 'react-router-dom'
import { FileText, Globe, BookOpen, Video, Mic, GraduationCap } from 'lucide-react'
import EvidenceBadge from './EvidenceBadge.jsx'
import StatusBadge   from './StatusBadge.jsx'
import { formatDate } from '../../utils/formatters.js'

const SOURCE_ICON = {
  book:    BookOpen,
  paper:   FileText,
  article: Globe,
  video:   Video,
  podcast: Mic,
  course:  GraduationCap,
}

const SOURCE_LABEL = {
  book:    'Book',
  paper:   'Paper',
  article: 'Article',
  video:   'Video',
  podcast: 'Podcast',
  course:  'Course',
}

export default function ResourceCard({ resource }) {
  const navigate = useNavigate()
  const Icon = SOURCE_ICON[resource.source_type] ?? FileText
  const tags = resource.topic_tags ?? resource.sport_tags ?? []

  return (
    <button
      onClick={() => navigate(`/knowledge/${resource.id}`)}
      className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-accent dark:hover:border-accent-dark hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-lg bg-gray-50 dark:bg-gray-700 shrink-0">
          <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug truncate">
              {resource.title}
            </p>
            <StatusBadge status={resource.status} />
          </div>

          {resource.author && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{resource.author}</p>
          )}

          <div className="flex items-center flex-wrap gap-1.5 mt-2">
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {SOURCE_LABEL[resource.source_type] ?? resource.source_type}
            </span>
            <EvidenceBadge level={resource.evidence_level} />
            {tags.slice(0, 3).map(t => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                {t}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
            {resource.chunk_count != null && (
              <span>{resource.chunk_count} chunks</span>
            )}
            {resource.updated_at && (
              <span>Updated {formatDate(resource.updated_at)}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
