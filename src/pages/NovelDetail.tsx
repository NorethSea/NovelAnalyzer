import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, Novel } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import StatusBadge from '../components/StatusBadge'
import LoadingState from '../components/LoadingState'
import Button from '../components/Button'
import { folderSourceLabel } from '../components/StatusFilterTabs'
import { formatFileSize, formatDate, formatChunkSize } from '../utils/format'

export default function NovelDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()

  const [novel, setNovel] = useState<Novel | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isPreferred, setIsPreferred] = useState(false)
  const [preferredNote, setPreferredNote] = useState('')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id) return
    const novelId = Number(id)
    if (!Number.isInteger(novelId) || novelId <= 0) {
      setLoading(false)
      toast.error('无效的小说ID')
      return
    }

    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const [novelData, prefData] = await Promise.all([
          api.novels.get(novelId),
          api.preferences.check(novelId).catch(() => ({ isPreferred: false })),
        ])
        if (cancelled) return
        setNovel(novelData)
        setIsPreferred(prefData.isPreferred)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, toast])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  async function handleAnalyze() {
    if (!novel) return
    setAnalyzing(true)
    try {
      await api.novels.analyze(novel.id)
      toast.info('已开始分析，几秒后可刷新查看进度')
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(async () => {
        try {
          const data = await api.novels.get(novel.id)
          setNovel(data)
        } catch (err) {
          console.warn('[NovelDetail] 刷新失败:', err)
        }
      }, 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分析失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleLike() {
    if (!novel) return
    try {
      await api.preferences.like(novel.id, preferredNote || undefined)
      setIsPreferred(true)
      setPreferredNote('')
      toast.success('已标记为喜欢')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    }
  }

  async function handleUnlike() {
    if (!novel) return
    try {
      await api.preferences.unlike(novel.id)
      setIsPreferred(false)
      toast.success('已取消喜欢')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    }
  }

  async function handleRefreshSummary() {
    if (!novel) return
    setRefreshing(true)
    try {
      const result = await api.novels.refreshSummary(novel.id)
      setNovel({ ...novel, content_summary: result.content_summary })
      toast.success('摘要已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDeleteAnalysis() {
    if (!novel) return
    const ok = await confirm({
      title: '删除分析',
      message: '确定要删除这本小说的分析结果吗？',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await api.novels.deleteAnalysis(novel.id)
      setNovel({ ...novel, status: 'pending', analysis: undefined })
      toast.success('分析结果已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  if (loading) return <LoadingState />
  if (!novel) return <div className="text-center py-12 text-gray-500">小说不存在</div>

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-indigo-600 hover:text-indigo-900 mb-4 text-sm">
        ← 返回
      </button>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-gray-900 break-words">{novel.title}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
              {novel.author && <span>作者: {novel.author}</span>}
              <span>来源: {folderSourceLabel(novel.folder_source)}</span>
              <span>大小: {formatFileSize(novel.file_size)}</span>
              <span>类型: {novel.file_type.toUpperCase()}</span>
              <span>导入: {formatDate(novel.created_at)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={novel.status} />
              {novel.file_path && (
                <code className="text-xs text-gray-400 truncate max-w-md" title={novel.file_path}>{novel.file_path}</code>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {(novel.status === 'pending' || novel.status === 'error' || novel.analysis) && (
                <Button
                  variant="success"
                  onClick={handleAnalyze}
                  disabled={analyzing || novel.status === 'analyzing'}
                >
                  {analyzing ? '提交中…'
                    : novel.status === 'analyzing' ? '分析中…'
                    : novel.analysis ? '重新分析' : '开始分析'}
                </Button>
              )}
              {(novel.analysis || novel.status !== 'pending') && (
                <Button variant="danger" onClick={handleDeleteAnalysis}>
                  删除分析
                </Button>
              )}
            </div>
            {!isPreferred ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="备注（可选）"
                  value={preferredNote}
                  onChange={(e) => setPreferredNote(e.target.value)}
                  maxLength={1000}
                  aria-label="喜欢备注"
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button variant="primary" className="bg-pink-600 hover:bg-pink-700 whitespace-nowrap" onClick={handleLike}>
                  标记喜欢
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={handleUnlike}>
                取消喜欢
              </Button>
            )}
          </div>
        </div>
      </div>

      {novel.content_summary && (
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-lg font-semibold">内容摘要</h3>
            <button onClick={handleRefreshSummary} disabled={refreshing} className="text-sm text-indigo-600 hover:text-indigo-900 disabled:opacity-50">
              {refreshing ? '生成中…' : '重新生成'}
            </button>
          </div>
          <p className="text-gray-600 text-sm whitespace-pre-wrap">{novel.content_summary}</p>
        </div>
      )}

      {novel.error_message && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
          <h3 className="text-lg font-semibold text-red-800 mb-2">错误信息</h3>
          <p className="text-red-600 text-sm whitespace-pre-wrap break-words">{novel.error_message}</p>
        </div>
      )}

      {novel.analysis ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">分析结果</h3>
            <span className="text-xs text-gray-400">
              {novel.analysis.model_used && <>模型: {novel.analysis.model_used} · </>}
              分块: {formatChunkSize(novel.analysis.chunk_size)} 字符 · {formatDate(novel.analysis.created_at)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnalysisCard title="主题分析" content={novel.analysis.theme} />
            <AnalysisCard title="情节分析" content={novel.analysis.plot} />
            <AnalysisCard title="人物分析" content={novel.analysis.characters} />
            <AnalysisCard title="写作风格" content={novel.analysis.writing_style} />
            <AnalysisCard title="情感分析" content={novel.analysis.emotion} />
            <AnalysisCard title="氛围分析" content={novel.analysis.atmosphere} />
            <AnalysisCard title="文学价值" content={novel.analysis.literary_value} />
            <AnalysisCard title="叙事技巧" content={novel.analysis.narrative_technique} />
            <AnalysisCard title="象征意义" content={novel.analysis.symbolism} />
          </div>
          {novel.analysis.overall_summary && (
            <div className="bg-white p-4 rounded-lg shadow">
              <h4 className="font-semibold mb-2">综合总结</h4>
              <p className="text-gray-600 text-sm whitespace-pre-wrap">{novel.analysis.overall_summary}</p>
            </div>
          )}
        </div>
      ) : novel.status === 'analyzing' ? (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
          <p className="text-blue-800 text-sm">正在分析中，请稍候…</p>
        </div>
      ) : null}
    </div>
  )
}

function AnalysisCard({ title, content }: { title: string; content: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!content) return null
  const longEnough = content.length > 280
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h4 className="font-semibold mb-2">{title}</h4>
      <p className={`text-gray-600 text-sm whitespace-pre-wrap ${longEnough && !expanded ? 'line-clamp-3' : ''}`}>
        {content}
      </p>
      {longEnough && (
        <button onClick={() => setExpanded(e => !e)} className="text-xs text-indigo-600 hover:text-indigo-800 mt-2">
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}
