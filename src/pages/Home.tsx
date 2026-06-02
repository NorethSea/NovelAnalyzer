import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, Novel } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import StatusFilterTabs, { StatusFilter, folderSourceLabel } from '../components/StatusFilterTabs'
import StatusBadge from '../components/StatusBadge'
import BatchProgress from '../components/BatchProgress'
import Pagination from '../components/Pagination'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import Button from '../components/Button'
import { useBatchStatus } from '../hooks/useBatchStatus'
import { useBatchAnalyze } from '../hooks/useBatchAnalyze'
import { useListSelection } from '../hooks/useListSelection'
import { formatFileSize, formatRelativeTime } from '../utils/format'

const PAGE_SIZE = 20

type SortKey = 'created' | 'title' | 'size'

export default function Home() {
  const toast = useToast()
  const confirm = useConfirm()
  const selection = useListSelection()
  const [searchParams, setSearchParams] = useSearchParams()

  const [novels, setNovels] = useState<Novel[]>([])
  const [loading, setLoading] = useState(true)
  const [importingA, setImportingA] = useState(false)
  const [importingB, setImportingB] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '')
  const search = searchParams.get('q') || ''
  const page = Number(searchParams.get('p')) || 1
  const statusFilter = (searchParams.get('status') as StatusFilter) || 'all'
  const sortBy = (searchParams.get('sort') as SortKey) || 'created'
  const sortDesc = searchParams.get('desc') !== '0'

  useEffect(() => {
    setSearchInput(searchParams.get('q') || '')
  }, [searchParams])

  useEffect(() => {
    const currentQ = searchParams.get('q') || ''
    if (searchInput === currentQ) return

    const t = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (searchInput) next.set('q', searchInput)
        else next.delete('q')
        next.delete('p')
        return next
      }, { replace: true })
    }, 200)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.novels.list()
      .then(data => { if (!cancelled) setNovels(data) })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey, toast])

  const batchRefreshRef = useRef<() => void>(() => {})
  batchRefreshRef.current = () => setRefreshKey(k => k + 1)
  const batchStatus = useBatchStatus(() => batchRefreshRef.current())

  const filteredNovels = useMemo(() => {
    const kw = search.trim().toLowerCase()
    const filtered = novels.filter(n => {
      const matchSearch = !kw
        || n.title.toLowerCase().includes(kw)
        || (n.author && n.author.toLowerCase().includes(kw))
      const matchStatus = statusFilter === 'all' || n.status === statusFilter
      return matchSearch && matchStatus
    })
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'title') cmp = a.title.localeCompare(b.title, 'zh-CN')
      else if (sortBy === 'size') cmp = (a.file_size ?? 0) - (b.file_size ?? 0)
      else cmp = a.created_at.localeCompare(b.created_at)
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [novels, search, statusFilter, sortBy, sortDesc])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: novels.length, pending: 0, analyzing: 0, completed: 0, error: 0,
    }
    for (const n of novels) {
      const s = n.status as StatusFilter
      if (s in counts) counts[s]++
    }
    return counts
  }, [novels])

  const { totalPages, currentPage, pagedNovels } = useMemo(() => {
    const tp = Math.max(1, Math.ceil(filteredNovels.length / PAGE_SIZE))
    const cp = Math.min(page, tp)
    const slice = filteredNovels.slice((cp - 1) * PAGE_SIZE, cp * PAGE_SIZE)
    return { totalPages: tp, currentPage: cp, pagedNovels: slice }
  }, [filteredNovels, page])

  const novelById = useMemo(() => {
    const m = new Map<number, Novel>()
    for (const n of novels) m.set(n.id, n)
    return m
  }, [novels])

  const handleBatchAnalyze = useBatchAnalyze({
    resolveNovels: (ids) => ids.map(id => novelById.get(id)).filter((n): n is Novel => !!n),
    onStarted: () => { selection.clear() },
  })

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

  async function handleBatchDelete() {
    if (selection.count === 0) return
    const ok = await confirm({
      title: '批量移除',
      message: `确定要从列表中移除 ${selection.count} 本小说吗？（文件保留）`,
      variant: 'danger',
      confirmText: '移除',
    })
    if (!ok) return
    const ids = selection.selectedIds
    let success = 0
    let failed = 0
    const errors: string[] = []
    for (const id of ids) {
      try {
        await api.novels.delete(id, false)
        success++
      } catch (err) {
        failed++
        errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    selection.clear()
    setRefreshKey(k => k + 1)
    if (failed === 0) toast.success(`已移除 ${success} 本`)
    else toast.warning(`移除 ${success} 本，失败 ${failed} 本\n${errors.slice(0, 3).join('\n')}`)
  }

  async function handleImport(folder: 'a' | 'b') {
    const setLoading = folder === 'a' ? setImportingA : setImportingB
    const label = folder === 'a' ? '小说库' : '收藏夹'
    setLoading(true)
    try {
      const result = folder === 'a'
        ? await api.novels.importFolderA()
        : await api.novels.importFolderB()
      const msg = `${label}: 新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}，删除 ${result.deleted}`
      if (result.errors && result.errors.length > 0) {
        toast.warning(`${msg}\n${result.errors.length} 个错误，详见控制台`)
        console.warn('导入错误:', result.errors)
      } else {
        toast.success(msg)
      }
      setRefreshKey(k => k + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: number, deleteFile: boolean) {
    const ok = await confirm({
      title: deleteFile ? '删除文件' : '从列表移除',
      message: deleteFile
        ? '确定要删除这本小说及对应文件吗？此操作不可恢复。'
        : '确定要从列表中移除这本小说吗？（文件保留）',
      variant: 'danger',
      confirmText: deleteFile ? '删除文件' : '移除',
    })
    if (!ok) return
    setDeletingId(id)
    try {
      await api.novels.delete(id, deleteFile)
      setRefreshKey(k => k + 1)
      toast.success(deleteFile ? '已删除' : '已移除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleAnalyze(id: number) {
    try {
      await api.novels.analyze(id)
      toast.info('已开始分析')
      setRefreshKey(k => k + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分析失败')
    }
  }

  const pageIds = useMemo(() => pagedNovels.map(n => n.id), [pagedNovels])
  const pageAllSelected = pageIds.length > 0 && pageIds.every(id => selection.isSelected(id))

  if (loading) {
    return <LoadingState />
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">小说列表</h2>
          <p className="text-sm text-gray-500 mt-1">
            共 {statusCounts.all} 本 · {statusCounts.completed} 已分析 · {statusCounts.pending} 待分析
            {statusCounts.analyzing > 0 && <> · {statusCounts.analyzing} 分析中</>}
            {statusCounts.error > 0 && <> · {statusCounts.error} 错误</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => handleImport('a')} loading={importingA}>导入小说库</Button>
          <Button variant="primary" className="bg-pink-600 hover:bg-pink-700" onClick={() => handleImport('b')} loading={importingB}>导入收藏夹</Button>
          <Button variant="ghost" onClick={() => setRefreshKey(k => k + 1)}>刷新</Button>
        </div>
      </div>

      {batchStatus.running && <BatchProgress {...batchStatus} />}

      {novels.length === 0 ? (
        <EmptyState
          icon="📚"
          title="还没有小说"
          description="请先到设置页配置小说库或收藏夹的路径，然后回到这里导入。"
          action={
            <Link to="/settings" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
              去设置
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 bg-white p-4 rounded-lg shadow">
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="搜索标题或作者…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="搜索"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <StatusFilterTabs value={statusFilter} onChange={v => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v !== 'all') n.set('status', v); else n.delete('status'); n.delete('p'); return n }, { replace: true })} counts={statusCounts} />
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 whitespace-nowrap">{filteredNovels.length} 本匹配</span>
                  <select
                    value={sortBy}
                    onChange={e => setSearchParams(prev => { const n = new URLSearchParams(prev); const v = e.target.value as SortKey; if (v !== 'created') n.set('sort', v); else n.delete('sort'); n.delete('p'); return n }, { replace: true })}
                    aria-label="排序字段"
                    className="px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="created">导入时间</option>
                    <option value="title">标题</option>
                    <option value="size">文件大小</option>
                  </select>
                  <button
                    onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); if (sortDesc) n.set('desc', '0'); else n.delete('desc'); n.delete('p'); return n }, { replace: true })}
                    aria-label={sortDesc ? '降序' : '升序'}
                    className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50"
                    title={sortDesc ? '降序' : '升序'}
                  >
                    {sortDesc ? '↓' : '↑'}
                  </button>
                </div>
              </div>
              {selection.count > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
                  <span className="text-sm text-gray-700">已选 {selection.count} 本</span>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => handleBatchAnalyze(selection.selectedIds)}
                    disabled={batchStatus.running}
                  >
                    批量分析
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleBatchDelete}>
                    批量移除
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleBatchDeleteAnalysis}>
                    批量删除分析
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => selection.clear()}>
                    取消选择
                  </Button>
                </div>
              )}
            </div>
          </div>

          {filteredNovels.length === 0 ? (
            <EmptyState title="无匹配结果" description="试着清除搜索词或切换状态筛选。" />
          ) : (
            <>
              <div className="hidden md:block bg-white shadow overflow-hidden rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left w-10">
                        <input
                          type="checkbox"
                          checked={pageAllSelected}
                          onChange={() => selection.toggleMany(pageIds)}
                          aria-label="全选当前页"
                          className="h-4 w-4 text-indigo-600 rounded"
                        />
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">作者</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">来源</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">大小</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">导入</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pagedNovels.map((novel) => (
                      <NovelRow
                        key={novel.id}
                        novel={novel}
                        selected={selection.isSelected(novel.id)}
                        deleting={deletingId === novel.id}
                        onToggle={() => selection.toggle(novel.id)}
                        onAnalyze={() => handleAnalyze(novel.id)}
                        onDelete={(del) => handleDelete(novel.id, del)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-3">
                <div className="flex items-center gap-2 bg-white p-2 rounded-md shadow-sm">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={() => selection.toggleMany(pageIds)}
                    aria-label="全选当前页"
                    className="h-4 w-4 text-indigo-600 rounded"
                  />
                  <span className="text-sm text-gray-500">全选当前页</span>
                </div>
                {pagedNovels.map((novel) => (
                  <NovelCard
                    key={novel.id}
                    novel={novel}
                    selected={selection.isSelected(novel.id)}
                    onToggle={() => selection.toggle(novel.id)}
                    onAnalyze={() => handleAnalyze(novel.id)}
                    onDelete={(del) => handleDelete(novel.id, del)}
                  />
                ))}
              </div>

              <Pagination page={currentPage} totalPages={totalPages} onChange={n => setSearchParams(prev => { const np = new URLSearchParams(prev); if (n > 1) np.set('p', String(n)); else np.delete('p'); return np }, { replace: true })} />
            </>
          )}
        </>
      )}
    </div>
  )
}

interface NovelRowProps {
  novel: Novel
  selected: boolean
  deleting?: boolean
  onToggle: () => void
  onAnalyze: () => void
  onDelete: (deleteFile: boolean) => void
}

const NovelRow = memo(function NovelRow({ novel, selected, deleting, onToggle, onAnalyze, onDelete }: NovelRowProps) {
  return (
    <tr className={`hover:bg-gray-50 ${selected ? 'bg-indigo-50' : ''}`}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`选择 ${novel.title}`}
          className="h-4 w-4 text-indigo-600 rounded"
        />
      </td>
      <td className="px-4 py-3 max-w-xs">
        <Link to={`/novel/${novel.id}`} className="text-indigo-600 hover:text-indigo-900 font-medium block truncate" title={novel.title}>
          {novel.title}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[8rem]">{novel.author || '-'}</td>
      <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={novel.status} /></td>
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{folderSourceLabel(novel.folder_source)}</td>
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatFileSize(novel.file_size)}</td>
      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap" title={novel.created_at}>{formatRelativeTime(novel.created_at)}</td>
      <td className="px-4 py-3 text-sm space-x-2 whitespace-nowrap">
        {(novel.status === 'pending' || novel.status === 'error') && (
          <button onClick={onAnalyze} className="text-green-600 hover:text-green-900">分析</button>
        )}
        <button onClick={() => onDelete(false)} disabled={deleting} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">移除</button>
        <button onClick={() => onDelete(true)} disabled={deleting} className="text-red-600 hover:text-red-900 disabled:opacity-50">删除文件</button>
      </td>
    </tr>
  )
})

const NovelCard = memo(function NovelCard({ novel, selected, onToggle, onAnalyze, onDelete }: NovelRowProps) {
  return (
    <div className={`bg-white p-4 rounded-lg shadow border ${selected ? 'border-indigo-300' : 'border-transparent'}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`选择 ${novel.title}`}
          className="h-4 w-4 text-indigo-600 rounded mt-1 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <Link to={`/novel/${novel.id}`} className="text-indigo-600 font-medium block truncate">
            {novel.title}
          </Link>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
            {novel.author && <span>作者: {novel.author}</span>}
            <span>{formatFileSize(novel.file_size)}</span>
            <span>{folderSourceLabel(novel.folder_source)}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <StatusBadge status={novel.status} />
            <div className="flex gap-3 text-sm">
              {(novel.status === 'pending' || novel.status === 'error') && (
                <button onClick={onAnalyze} className="text-green-600">分析</button>
              )}
              <button onClick={() => onDelete(false)} className="text-gray-600">移除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
