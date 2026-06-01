import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: string
}

export default function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="text-center py-16 bg-white rounded-lg shadow">
      {icon && <div className="text-5xl mb-3 opacity-60" aria-hidden="true">{icon}</div>}
      <p className="text-gray-700 font-medium">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
