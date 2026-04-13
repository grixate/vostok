import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CallQualityIndicator } from './CallQualityIndicator.tsx'

describe('CallQualityIndicator', () => {
  it('renders transport dot and waveform with independent state classes', () => {
    const markup = renderToStaticMarkup(
      <CallQualityIndicator
        transportStatus="connected"
        quality="fair"
        profile="low"
      />
    )

    expect(markup).toContain('call-transport-dot--connected')
    expect(markup).toContain('call-quality-wave--fair')
    expect(markup).toContain('call-quality-wave__bar')
    expect(markup).toContain('Transport: Connected')
    expect(markup).toContain('Media quality: Constrained (Low-bandwidth video)')
  })

  it('uses deterministic tooltip labels', () => {
    const markup = renderToStaticMarkup(
      <CallQualityIndicator
        transportStatus="disconnected"
        quality="poor"
        profile="audio_fallback"
      />
    )

    expect(markup).toContain('Transport: Disconnected')
    expect(markup).toContain('Media quality: Poor (Audio-priority mode active)')
  })
})
