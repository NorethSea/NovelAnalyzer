import { statusBadge, statusLabel } from './StatusFilterTabs'

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge(status)}`}>
      {statusLabel(status)}
    </span>
  )
}
