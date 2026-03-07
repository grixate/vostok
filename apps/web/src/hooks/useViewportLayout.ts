import { useEffect, useState } from 'react'
import { DESKTOP_DETAIL_RAIL_BREAKPOINT, DETAIL_RAIL_STORAGE_KEY } from '../constants.ts'
import { readDetailRailPreference } from '../utils/storage.ts'

export function useViewportLayout() {
  const [detailRailPreferred, setDetailRailPreferred] = useState(() => readDetailRailPreference())
  const [isDesktopWide, setIsDesktopWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncViewportMode = () => {
      setIsDesktopWide(window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT)
    }

    syncViewportMode()
    window.addEventListener('resize', syncViewportMode)

    return () => {
      window.removeEventListener('resize', syncViewportMode)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, String(detailRailPreferred))
  }, [detailRailPreferred])

  const detailRailVisible = detailRailPreferred && isDesktopWide

  return {
    detailRailPreferred,
    setDetailRailPreferred,
    isDesktopWide,
    detailRailVisible
  }
}
