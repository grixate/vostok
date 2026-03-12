import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_WIDTH = 280
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 380
const STORAGE_KEY = 'vostok.layout.sidebar_width'

type ResizeHandleProps = {
  onWidthChange?: (width: number) => void
}

export function ResizeHandle({ onWidthChange }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(DEFAULT_WIDTH)

  const getComputedSidebarWidth = useCallback((): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : DEFAULT_WIDTH
  }, [])

  const setSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
    document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
    onWidthChange?.(clamped)
  }, [onWidthChange])

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    startXRef.current = event.clientX
    startWidthRef.current = getComputedSidebarWidth()
    setDragging(true)
  }, [getComputedSidebarWidth])

  const handleDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_WIDTH)
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH))
  }, [setSidebarWidth])

  useEffect(() => {
    if (!dragging) return

    function handleMouseMove(event: MouseEvent) {
      const delta = event.clientX - startXRef.current
      const newWidth = startWidthRef.current + delta
      setSidebarWidth(newWidth)
    }

    function handleMouseUp(event: MouseEvent) {
      const delta = event.clientX - startXRef.current
      const finalWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
      localStorage.setItem(STORAGE_KEY, String(finalWidth))
      setDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, setSidebarWidth])

  return (
    <div
      className={dragging ? 'resize-handle resize-handle--active' : 'resize-handle'}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    />
  )
}
