import { useEffect, useRef, useState } from 'react'
import type { MembraneClient } from '../lib/membrane-native.ts'
import { getMembranePeerConnection } from '../lib/membrane-native.ts'

export type CallQuality = 'good' | 'fair' | 'poor' | 'reconnecting'

type StatsSnapshot = {
  timestamp: number
  bytesReceived: number
  packetsReceived: number
  packetsLost: number
}

function deriveQuality(
  packetLossRate: number,
  rtt: number | null,
  iceState: RTCIceConnectionState | undefined
): CallQuality {
  if (iceState === 'disconnected' || iceState === 'checking') return 'reconnecting'
  if (iceState === 'failed') return 'poor'
  if (packetLossRate > 0.05 || (rtt !== null && rtt > 0.4)) return 'poor'
  if (packetLossRate > 0.02 || (rtt !== null && rtt > 0.2)) return 'fair'
  return 'good'
}

export function useCallQuality(
  membraneClientRef: React.RefObject<MembraneClient | null>,
  active: boolean
): CallQuality {
  const [quality, setQuality] = useState<CallQuality>('good')
  const prevSnapshot = useRef<StatsSnapshot | null>(null)

  useEffect(() => {
    if (!active) {
      prevSnapshot.current = null
      setQuality('good')
      return
    }

    let cancelled = false

    async function poll() {
      const pc = getMembranePeerConnection(membraneClientRef.current)
      if (!pc || cancelled) return

      const iceState = pc.iceConnectionState

      try {
        const stats = await pc.getStats()
        let bytesReceived = 0
        let packetsReceived = 0
        let packetsLost = 0
        let rtt: number | null = null

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            bytesReceived += report.bytesReceived ?? 0
            packetsReceived += report.packetsReceived ?? 0
            packetsLost += report.packetsLost ?? 0
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number') {
              rtt = report.currentRoundTripTime
            }
          }
        })

        const now = performance.now()
        const prev = prevSnapshot.current

        let lossRate = 0
        if (prev) {
          const deltaPackets = (packetsReceived + packetsLost) - (prev.packetsReceived + prev.packetsLost)
          const deltaLost = packetsLost - prev.packetsLost
          if (deltaPackets > 0) {
            lossRate = deltaLost / deltaPackets
          }
        }

        prevSnapshot.current = { timestamp: now, bytesReceived, packetsReceived, packetsLost }

        if (!cancelled) {
          setQuality(deriveQuality(lossRate, rtt, iceState))
        }
      } catch {
        // getStats() can fail during teardown
      }
    }

    const intervalId = window.setInterval(poll, 2000)
    void poll()

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [active, membraneClientRef])

  return quality
}
