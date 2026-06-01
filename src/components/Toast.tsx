import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

interface Toast {
  id: number
  kind: ToastKind
  message: string
  timerId?: ReturnType<typeof setTimeout>
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_STYLES: Record<ToastKind, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
}

const TOAST_DURATION: Record<ToastKind, number> = {
  info: 3500,
  success: 3500,
  warning: 4000,
  error: 6000,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const remove = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++idRef.current
    const timerId = setTimeout(() => remove(id), TOAST_DURATION[kind])
    timersRef.current.set(id, timerId)
    setToasts(prev => [...prev, { id, kind, message, timerId }])
  }, [remove])

  const value = useMemo<ToastContextValue>(() => ({
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
    warning: (m) => show(m, 'warning'),
  }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`pointer-events-auto min-w-[260px] max-w-md px-4 py-3 rounded-md shadow-md border ${TOAST_STYLES[toast.kind]} flex items-start gap-3 animate-slide-in`}>
      <div className="flex-1 text-sm break-words whitespace-pre-wrap">{toast.message}</div>
      <button onClick={onClose} aria-label="关闭通知" className="text-current opacity-60 hover:opacity-100 leading-none">✕</button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}

export function useToastErrorHandler() {
  const toast = useToast()
  return useCallback((err: unknown, fallback = '操作失败') => {
    toast.error(err instanceof Error ? err.message : fallback)
  }, [toast])
}
