import { useCallback } from 'react'
import { api, Novel } from '../api'
import { useConfirm } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'

interface Options {
  resolveNovels: (ids: number[]) => Pick<Novel, 'id' | 'status'>[]
  onStarted?: () => void
}

export function useBatchAnalyze({ resolveNovels, onStarted }: Options) {
  const confirm = useConfirm()
  const toast = useToast()

  return useCallback(async (selectedIds: number[]) => {
    if (selectedIds.length === 0) return false

    const novels = resolveNovels(selectedIds)
    const pendingIds = novels
      .filter(n => n.status === 'pending' || n.status === 'error')
      .map(n => n.id)

    if (pendingIds.length === 0) {
      toast.warning('选中的小说没有需要分析的')
      return false
    }

    const ok = await confirm({
      title: '批量分析',
      message: `确定要批量分析 ${pendingIds.length} 本小说吗？`,
      confirmText: '开始分析',
    })
    if (!ok) return false

    try {
      await api.novels.batchAnalyze(pendingIds)
      toast.info(`已加入分析队列：${pendingIds.length} 本`)
      onStarted?.()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量分析启动失败')
      return false
    }
  }, [confirm, toast, resolveNovels, onStarted])
}
