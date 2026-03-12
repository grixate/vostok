import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
  text: string
  children: ReactNode
  delay?: number
}

export function Tooltip({ text, children, delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return

      const rect = triggerRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top - 6,
        left: rect.left + rect.width / 2
      })
      setVisible(true)
    }, delay)
  }, [delay])

  const hideTooltip = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }, [])

  return (
    <span
      ref={triggerRef}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {visible
        ? createPortal(
            <div
              className="tooltip tooltip--visible"
              style={{
                top: coords.top,
                left: coords.left,
              }}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}
