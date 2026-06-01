interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export default function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages: (number | string)[] = []
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) {
      if (pages.length > 0 && typeof pages[pages.length - 1] === 'number' && p - (pages[pages.length - 1] as number) > 1) {
        pages.push('...')
      }
      pages.push(p)
    }
  }

  return (
    <div className="flex justify-center items-center flex-wrap gap-1 mt-6">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
      >
        上一页
      </button>
      {pages.map((p, i) =>
        typeof p === 'string' ? (
          <span key={`e-${i}`} className="px-2 text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-3 py-1 border rounded text-sm ${
              p === page ? 'bg-indigo-600 text-white border-indigo-600' : 'hover:bg-gray-50'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
      >
        下一页
      </button>
      <span className="text-sm text-gray-500 ml-2">{page}/{totalPages}</span>
    </div>
  )
}
