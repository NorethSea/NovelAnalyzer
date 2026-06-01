import { useEffect, useRef, useState } from 'react'

export interface BatchStatus {
  running: boolean
  total: number
  completed: number
  failed: number
  current: string
  type?: 'analyze' | 'recommend'
}

const INITIAL: BatchStatus = { running: false, total: 0, completed: 0, failed: 0, current: '' }
const MAX_BACKOFF_MS = 30_000
const THROTTLE_MS = 200

export function useBatchStatus(onCompleted?: () => void) {
  const [status, setStatus] = useState<BatchStatus>(INITIAL)
  const wasRunningRef = useRef(false)
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted

  useEffect(() => {
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = 1000
    let cancelled = false
    let lastFlushAt = 0
    let pendingStatus: BatchStatus | null = null
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      if (pendingStatus) {
        setStatus(pendingStatus);
        pendingStatus = null;
      }
      flushTimer = null;
    };

    const handle = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as BatchStatus
        const now = Date.now()
        if (data.running || now - lastFlushAt >= THROTTLE_MS) {
          setStatus(data)
          lastFlushAt = now
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
        } else {
          pendingStatus = data
          if (!flushTimer) flushTimer = setTimeout(flush, THROTTLE_MS)
        }
        if (wasRunningRef.current && !data.running) {
          onCompletedRef.current?.()
        }
        wasRunningRef.current = data.running
      } catch (err) {
        console.warn('[useBatchStatus] 解析消息失败:', err)
      }
    }

    const connect = () => {
      if (cancelled) return
      es = new EventSource('/api/events/batch')
      es.addEventListener('snapshot', handle)
      es.addEventListener('batch', handle)
      es.onopen = () => { backoff = 1000 }
      es.onerror = (e) => {
        if (cancelled) return
        const readyState = es?.readyState
        if (readyState === EventSource.CLOSED) {
          console.warn('[useBatchStatus] 连接已关闭，停止重连')
          return
        }
        es?.close()
        es = null
        retryTimer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (flushTimer) clearTimeout(flushTimer)
      es?.close()
    }
  }, [])

  return status
}
