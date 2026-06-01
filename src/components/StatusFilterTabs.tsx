export type NovelStatus = 'pending' | 'analyzing' | 'completed' | 'error'
export type StatusFilter = 'all' | NovelStatus

interface StatusFilterTabsProps {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
  counts: Record<StatusFilter, number>
}

const STATUS_META: Record<StatusFilter, { label: string; activeClass: string }> = {
  all: { label: '全部', activeClass: 'bg-indigo-600 text-white' },
  pending: { label: '待分析', activeClass: 'bg-yellow-500 text-white' },
  analyzing: { label: '分析中', activeClass: 'bg-blue-500 text-white' },
  completed: { label: '已完成', activeClass: 'bg-green-500 text-white' },
  error: { label: '错误', activeClass: 'bg-red-500 text-white' },
}

const STATUS_BADGE_MAP: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  analyzing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
}

const ORDER: StatusFilter[] = ['all', 'pending', 'analyzing', 'completed', 'error']

function isStatusFilter(s: string): s is StatusFilter {
  return s in STATUS_META
}

export default function StatusFilterTabs({ value, onChange, counts }: StatusFilterTabsProps) {
  return (
    <div className="flex gap-2 flex-wrap" role="tablist" aria-label="状态筛选">
      {ORDER.map(status => {
        const meta = STATUS_META[status]
        const active = value === status
        return (
          <button
            key={status}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(status)}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              active ? meta.activeClass : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {meta.label} ({counts[status]})
          </button>
        )
      })}
    </div>
  )
}

export function statusLabel(status: string): string {
  return isStatusFilter(status) ? STATUS_META[status].label : status
}

export function statusBadge(status: string): string {
  return STATUS_BADGE_MAP[status] || 'bg-gray-100 text-gray-800'
}

export function folderSourceLabel(source: string | null | undefined): string {
  if (source === 'folder_a') return '小说库'
  if (source === 'folder_b') return '收藏夹'
  return '-'
}
