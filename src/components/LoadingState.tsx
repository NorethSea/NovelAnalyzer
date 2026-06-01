interface LoadingStateProps {
  message?: string
  className?: string
}

export default function LoadingState({ message = '加载中…', className = 'py-12' }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={`text-center text-gray-500 ${className}`}>
      <div className="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
      <span>{message}</span>
    </div>
  )
}
