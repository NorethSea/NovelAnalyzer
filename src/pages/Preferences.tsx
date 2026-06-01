import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Preference } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import StatusFilterTabs, { StatusFilter } from '../components/StatusFilterTabs'
import StatusBadge from '../components/StatusBadge'
import BatchProgress from '../components/BatchProgress'
import Pagination from '../components/Pagination'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import Button from '../components/Button'
import { useBatchStatus } from '../hooks/useBatchStatus'
import { useBatchAnalyze } from '../hooks/useBatchAnalyze'
import { useListSelection } from '../hooks/useListSelection'

const PAGE_SIZE = 20

export default function Preferences() {
  const toast = useToast()
  const confirm = useConfirm()
  const selection = useListSelection()

  const [preferences, setPreferences] = useState<Preference[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.preferences.list()
      .then(data => { if (!cancelled) setPreferences(data) })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey, toast])

  const batchRefreshRef = useRef<() => void>(() => {})
  batchRefreshRef.current = () => setRefreshKey(k => k + 1)
  const batchStatus = useBatchStatus(() => batchRefreshRef.current())

  async function handleUnlike(novelId: number) {
    const ok = await confirm({
      title: '取消喜欢',
      message: '确定要取消喜欢这本小说吗？',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.preferences.unlike(novelId)
      toast.success('已取消喜欢')
      setRefreshKey(k => k + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    }
  }

  async function handleBatchDeleteAnalysis() {
    if (selection.count === 0) return
    const ok = await confirm({
      title: '批量删除分析',
      message: `确定要清除 ${selection.count} 本小说的分析结果吗？\n\n（仅删除分析数据，小说本身保留，状态会重置为待分析）`,
      variant: 'danger',
      confirmText: '清除分析',
    })
    if (!ok) return
    const ids = selection.selectedIds
    try {
      const result = await api.novels.batchDeleteAnalysis(ids)
      selection.clear()
      setRefreshKey(k => k + 1)
      toast.success(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清除分析失败')
    }
  }

  const novelById = useMemo(() => {
    const m = new Map<number, Preference['novel']>()
    for (const p of preferences) if (p.novel) m.set(p.novel.id, p.novel)
    return m
  }, [preferences])

  const handleBatchAnalyze = useBatchAnalyze({
    resolveNovels: (ids) => ids
      .map(id => novelById.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map(n => ({ id: n.id, status: n.status })),
    onStarted: () => selection.clear(),
  })

  function analyzeAll() {
    const ids = preferences
      .filter(p => p.novel && (p.novel.status === 'pending' || p.novel.status === 'error'))
      .map(p => p.novel_id)
    handleBatchAnalyze(ids)
  }

  const filteredPreferences = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return preferences.filter(pref => {
      const matchesSearch = !kw
        || pref.novel?.title?.toLowerCase().includes(kw)
        || pref.novel?.author?.toLowerCase().includes(kw)
      const matchesStatus = statusFilter === 'all' || pref.novel?.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [preferences, search, statusFilter])

  const { totalPages, currentPage, pagedPreferences } = useMemo(() => {
    const tp = Math.max(1, Math.ceil(filteredPreferences.length / PAGE_SIZE))
    const cp = Math.min(page, tp)
    return { totalPages: tp, currentPage: cp, pagedPreferences: filteredPreferences.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE) }
  }, [filteredPreferences, page])

  useEffect(() => { setPage(1) }, [search, statusFilter])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: preferences.length, pending: 0, completed: 0, analyzing: 0, error: 0,
    }
    for (const pref of preferences) {
      const status = pref.novel?.status as StatusFilter
      if (status && status in counts) counts[status]++
    }
    return counts
  }, [preferences])

  const pageIds = useMemo(() => pagedPreferences.map(p => p.novel_id), [pagedPreferences])
  const allSelected = pageIds.length > 0 && pageIds.every(id => selection.isSelected(id))
  const needAnalysis = preferences.filter(p => p.novel && (p.novel.status === 'pending' || p.novel.status === 'error')).length

  if (loading) return <LoadingState />

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">喜欢的小说</h2>
          <p className="text-sm text-gray-500 mt-1">共 {preferences.length} 本</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selection.count > 0 && (
            <>
              <Button variant="success" onClick={() => handleBatchAnalyze(selection.selectedIds)} disabled={batchStatus.running}>
                批量分析 ({selection.count})
              </Button>
              <Button variant="secondary" onClick={handleBatchDeleteAnalysis}>
                批量删除分析
              </Button>
            </>
          )}
          {needAnalysis > 0 && (
            <Button variant="primary" onClick={analyzeAll} disabled={batchStatus.running}>
              分析全部未分析 ({needAnalysis})
            </Button>
          )}
        </div>
      </div>

      {batchStatus.running && <BatchProgress {...batchStatus} />}

      {preferences.length === 0 ? (
        <EmptyState
          icon="❤️"
          title="还没有喜欢的小说"
          description="在小说详情页标记喜欢，或从收藏夹导入。"
        />
      ) : (
        <>
          <div className="mb-4 bg-white p-4 rounded-lg shadow">
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="搜索书名或作者…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="搜索"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <StatusFilterTabs value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => selection.toggleMany(pageIds)}
                    aria-label="全选当前页"
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <span className="text-sm text-gray-500">全选当前页</span>
                </div>
              </div>
            </div>
          </div>

          {filteredPreferences.length === 0 ? (
            <EmptyState title="无匹配结果" description="试着调整搜索或筛选条件。" />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pagedPreferences.map((pref) => (
                  <div key={pref.id} className={`bg-white p-4 rounded-lg shadow border ${selection.isSelected(pref.novel_id) ? 'border-indigo-300' : 'border-transparent'}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={selection.isSelected(pref.novel_id)}
                            onChange={() => selection.toggle(pref.novel_id)}
                            aria-label={`选择 ${pref.novel?.title || pref.novel_id}`}
                            className="h-4 w-4 text-indigo-600 rounded flex-shrink-0"
                          />
                          <Link to={`/novel/${pref.novel_id}`} className="text-indigo-600 hover:text-indigo-900 font-semibold truncate">
                            {pref.novel?.title || `小说#${pref.novel_id}`}
                          </Link>
                        </div>
                        <div className="ml-6 mt-1 space-y-1">
                          {pref.novel?.author && <p className="text-sm text-gray-500 truncate">作者: {pref.novel.author}</p>}
                          {pref.novel?.status && <StatusBadge status={pref.novel.status} />}
                          {pref.note && <p className="text-xs text-gray-400 italic truncate" title={pref.note}>备注: {pref.note}</p>}
                          {pref.analysis?.overall_summary && (
                            <p className="text-sm text-gray-600 line-clamp-3">{pref.analysis.overall_summary}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnlike(pref.novel_id)}
                        aria-label="取消喜欢"
                        className="text-gray-400 hover:text-red-500 flex-shrink-0"
                        title="取消喜欢"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </>
      )}
    </div>
  )
}
