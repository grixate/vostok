import { describe, expect, it } from 'vitest'
import { getRoundVideoPlayableDuration, getRoundVideoProgress } from './RoundVideoBubble.tsx'

describe('RoundVideoBubble progress math', () => {
  it('uses seekable end for playable duration when container duration is longer', () => {
    const playable = getRoundVideoPlayableDuration({ seekableEnd: 8, duration: 10 })
    expect(playable).toBe(8)

    const progressAtPlayableEnd = getRoundVideoProgress({
      currentTime: 8,
      seekableEnd: 8,
      duration: 10
    })
    expect(progressAtPlayableEnd).toBe(1)
  })

  it('falls back to media duration when no seekable range is available', () => {
    const progress = getRoundVideoProgress({
      currentTime: 7.5,
      seekableEnd: 0,
      duration: 10
    })
    expect(progress).toBe(0.75)
  })
})
