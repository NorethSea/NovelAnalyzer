import { useCallback, useMemo, useState } from 'react'

export interface UseListSelectionReturn {
  selected: Set<number>
  selectedIds: number[]
  isSelected: (id: number) => boolean
  toggle: (id: number) => void
  toggleMany: (ids: number[], forceSelect?: boolean) => void
  clear: () => void
  setAll: (ids: number[]) => void
  count: number
}

export function useListSelection(initial: number[] = []): UseListSelectionReturn {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initial))

  const isSelected = useCallback((id: number) => selected.has(id), [selected])

  const toggle = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleMany = useCallback((ids: number[], forceSelect?: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      const allSelected = ids.every(id => next.has(id))
      const want = forceSelect !== undefined ? forceSelect : !allSelected
      if (want) ids.forEach(id => next.add(id))
      else ids.forEach(id => next.delete(id))
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])
  const setAll = useCallback((ids: number[]) => setSelected(new Set(ids)), [])

  const selectedIds = useMemo(() => Array.from(selected), [selected])

  return {
    selected,
    selectedIds,
    isSelected,
    toggle,
    toggleMany,
    clear,
    setAll,
    count: selected.size,
  }
}
