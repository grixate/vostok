import { useMemo } from 'react'

type GridDimensions = {
  columns: number
  rows: number
  template: string
}

export function useGridLayout(participantCount: number): GridDimensions {
  return useMemo(() => {
    if (participantCount <= 1) return { columns: 1, rows: 1, template: '1fr' }
    if (participantCount === 2) return { columns: 2, rows: 1, template: '1fr 1fr' }
    if (participantCount <= 4) return { columns: 2, rows: 2, template: '1fr 1fr' }
    if (participantCount <= 6) return { columns: 3, rows: 2, template: '1fr 1fr 1fr' }
    if (participantCount <= 9) return { columns: 3, rows: 3, template: '1fr 1fr 1fr' }
    return { columns: 4, rows: 3, template: '1fr 1fr 1fr 1fr' }
  }, [participantCount])
}
