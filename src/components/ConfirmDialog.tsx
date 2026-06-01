import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'danger'
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose(false)
      }
    }
    window.addEventListener('keydown', onKey)
    cancelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  function handleClose(ok: boolean) {
    if (!pending) return
    pending.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => handleClose(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={pending.title ? titleId : undefined}
            className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && (
              <h2 id={titleId} className="px-5 pt-5 pb-2 text-lg font-semibold text-gray-900">{pending.title}</h2>
            )}
            <div className="px-5 py-3 text-sm text-gray-700 whitespace-pre-wrap">{pending.message}</div>
            <div className="px-5 py-3 bg-gray-50 flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={() => handleClose(false)}
                className="px-4 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-100"
              >
                {pending.cancelText || '取消'}
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-1.5 text-sm rounded-md text-white ${
                  pending.variant === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {pending.confirmText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

let _idCounter = 0
function useId() {
  const ref = useRef<string>()
  if (!ref.current) ref.current = `confirm-title-${++_idCounter}`
  return ref.current
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be inside ConfirmProvider')
  return ctx.confirm
}
