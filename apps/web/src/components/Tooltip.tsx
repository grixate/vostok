import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
  text: string
  children: ReactNode
  delay?: number
}

export function Tooltip({ text, children, delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tooltipMeasureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || !triggerRef.current) return

    const trigger = triggerRef.current.getBoundingClientRect()
    const tip = el.getBoundingClientRect()
    const vw = window.innerWidth
    const pad = 8

    // Vertical: prefer above, flip below if clipped
    let top: number
    let placement: 'above' | 'below'
    if (trigger.top - tip.height - 6 < pad) {
      top = trigger.bottom + 6
      placement = 'below'
    } else {
      top = trigger.top - tip.height - 6
      placement = 'above'
    }

    // Horizontal: center on trigger, then clamp to viewport
    let left = trigger.left + trigger.width / 2 - tip.width / 2
    if (left < pad) left = pad
    if (left + tip.width > vw - pad) left = vw - pad - tip.width

    setStyle({ top, left, transform: 'none', opacity: 1 })
    void placement // used for future arrow direction if needed
  }, [])

  const showTooltip = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      // Initial position off-screen for measurement
      setStyle({ top: -9999, left: -9999, transform: 'none', opacity: 0 })
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
              ref={tooltipMeasureRef}
              className="tooltip tooltip--visible"
              style={style}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}
