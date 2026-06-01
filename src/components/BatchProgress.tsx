interface BatchProgressProps {
  total: number
  completed: number
  failed: number
  current: string
}

export default function BatchProgress({ total, completed, failed, current }: BatchProgressProps) {
  const done = completed + failed
  const percent = total > 0 ? (done / total) * 100 : 0

  return (
    <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-md">
      <div className="flex justify-between items-center mb-2">
        <span className="text-indigo-800 font-medium">批量分析进行中…</span>
        <span className="text-sm text-indigo-600">
          {done}/{total}
          {failed > 0 && <span className="text-red-500 ml-2">({failed} 失败)</span>}
        </span>
      </div>
      <div className="w-full bg-indigo-200 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      {current && (
        <p className="text-sm text-indigo-600 mt-2 truncate" title={current}>当前: {current}</p>
      )}
    </div>
  )
}
