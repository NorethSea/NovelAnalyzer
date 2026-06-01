import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Recommendation } from '../api'
import { useToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'
import Button from '../components/Button'

type Filter = 'all' | 'recommended' | 'not_recommended'
type SortKey = 'score' | 'created'

const FILTER_META: Record<Filter, { label: string; activeClass: string }> = {
  all: { label: '全部', activeClass: 'bg-indigo-600 text-white' },
  recommended: { label: '推荐', activeClass: 'bg-green-600 text-white' },
  not_recommended: { label: '不推荐', activeClass: 'bg-red-600 text-white' },
}

const FILTER_ORDER: Filter[] = ['all', 'recommended', 'not_recommended']

export default function Recommendations() {
  const toast = useToast()
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [sortBy, setSortBy] = useState<SortKey>('score')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.recommendations.list()
      .then(data => { if (!cancelled) setRecommendations(data) })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [toast])

  async function handleGenerate() {
    setGenerating(true)
    try {
      await api.recommendations.generate()
      toast.success('推荐生成完成')
      const data = await api.recommendations.list()
      setRecommendations(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成推荐失败')
    } finally {
      setGenerating(false)
    }
  }

  const sortedRecommendations = useMemo(() => {
    const filtered = recommendations.filter(rec => filter === 'all' || rec.category === filter)
    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return (b.score ?? 0) - (a.score ?? 0)
      return b.created_at.localeCompare(a.created_at)
    })
  }, [recommendations, filter, sortBy])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: recommendations.length, recommended: 0, not_recommended: 0 }
    for (const r of recommendations) {
      if (r.category === 'recommended' || r.category === 'not_recommended') c[r.category]++
    }
    return c
  }, [recommendations])

  if (loading) return <LoadingState />

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">推荐列表</h2>
          <p className="text-sm text-gray-500 mt-1">
            推荐 {counts.recommended} 本 · 不推荐 {counts.not_recommended} 本
          </p>
        </div>
        <Button variant="primary" onClick={handleGenerate} loading={generating}>
          生成推荐
        </Button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow mb-4 flex flex-col sm:flex-row sm:justify-between gap-3">
        <div className="flex gap-2 flex-wrap" role="tablist" aria-label="推荐筛选">
          {FILTER_ORDER.map(f => {
            const meta = FILTER_META[f]
            const active = filter === f
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  active ? meta.activeClass : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {meta.label} ({counts[f]})
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">排序:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="排序方式"
            className="px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="score">相似度</option>
            <option value="created">生成时间</option>
          </select>
        </div>
      </div>

      {sortedRecommendations.length === 0 ? (
        <EmptyState
          icon="⭐"
          title={recommendations.length === 0 ? '暂无推荐' : '当前筛选条件下无结果'}
          description={recommendations.length === 0
            ? '请先标记喜欢的小说并点击"生成推荐"。'
            : '试着切换筛选条件查看其他结果。'}
        />
      ) : (
        <div className="space-y-3">
          {sortedRecommendations.map((rec) => (
            <div
              key={rec.id}
              className={`bg-white p-4 rounded-lg shadow border-l-4 ${
                rec.category === 'recommended' ? 'border-green-500' : 'border-red-500'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/novel/${rec.novel_id}`} className="text-indigo-600 hover:text-indigo-900 font-semibold">
                  {rec.novel?.title || `小说#${rec.novel_id}`}
                </Link>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  rec.category === 'recommended' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {rec.category === 'recommended' ? '推荐' : '不推荐'}
                </span>
                {rec.score !== null && (
                  <span className="text-sm text-gray-500">相似度: {(rec.score * 100).toFixed(0)}%</span>
                )}
                {rec.novel?.author && (
                  <span className="text-sm text-gray-400 ml-auto">作者: {rec.novel.author}</span>
                )}
              </div>
              <p className="text-gray-600 mt-2 whitespace-pre-wrap text-sm">{rec.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
