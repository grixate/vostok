import { useState, useEffect, useRef } from 'react'

export function useCallTimer(active: boolean): string {
  const [seconds, setSeconds] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setSeconds(0)
      startRef.current = null
      return
    }

    startRef.current = Date.now()
    setSeconds(0)

    const timer = setInterval(() => {
      if (startRef.current) {
        setSeconds(Math.floor((Date.now() - startRef.current) / 1000))
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [active])

  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
