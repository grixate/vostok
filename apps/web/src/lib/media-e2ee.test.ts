import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCallCapability, supportsMediaE2EE } from './media-e2ee.ts'

function stubWindow(overrides: Record<string, unknown> = {}) {
  const baseWindow = {
    navigator: {
      mediaDevices: {
        getUserMedia: vi.fn()
      }
    },
    crypto: {
      subtle: {}
    },
    Worker: class {},
    RTCRtpScriptTransform: class {},
    RTCRtpSender: {
      prototype: {
        transform: null
      }
    },
    RTCRtpReceiver: {
      prototype: {
        transform: null
      }
    }
  }

  vi.stubGlobal('window', {
    ...baseWindow,
    ...overrides
  })
  vi.stubGlobal('navigator', (globalThis as { window: { navigator: Navigator } }).window.navigator)
}

describe('getCallCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports standards-based encoded transforms as supported', () => {
    stubWindow()

    expect(getCallCapability()).toMatchObject({
      state: 'supported',
      transport: 'standard',
      hostKind: 'browser'
    })
    expect(supportsMediaE2EE()).toBe(true)
  })

  it('detects desktop shell hosts and common browser names', () => {
    stubWindow({
      __TAURI_INTERNALS__: {},
      navigator: {
        mediaDevices: {
          getUserMedia: vi.fn()
        },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
      }
    })

    expect(getCallCapability()).toMatchObject({
      hostKind: 'desktop',
      browserName: 'Safari'
    })
  })

  it('falls back to the legacy Chromium encoded-stream transport', () => {
    stubWindow({
      RTCRtpScriptTransform: undefined,
      RTCRtpSender: {
        prototype: {
          createEncodedStreams: vi.fn()
        }
      },
      RTCRtpReceiver: {
        prototype: {
          createEncodedStreams: vi.fn()
        }
      }
    })

    expect(getCallCapability()).toMatchObject({
      state: 'supported',
      transport: 'legacy'
    })
  })

  it('fails closed when media capture is unavailable', () => {
    stubWindow({
      navigator: {}
    })

    expect(getCallCapability()).toMatchObject({
      state: 'unsupported_media_capture',
      transport: 'unsupported'
    })
    expect(supportsMediaE2EE()).toBe(false)
  })

  it('fails closed when workers are unavailable', () => {
    stubWindow({
      Worker: undefined,
      RTCRtpScriptTransform: undefined,
      RTCRtpSender: {
        prototype: {
          transform: null
        }
      },
      RTCRtpReceiver: {
        prototype: {
          transform: null
        }
      }
    })

    expect(getCallCapability()).toMatchObject({
      state: 'unsupported_worker',
      transport: 'unsupported'
    })
  })

  it('fails closed when no encoded transform transport exists', () => {
    stubWindow({
      RTCRtpScriptTransform: undefined,
      RTCRtpSender: {
        prototype: {}
      },
      RTCRtpReceiver: {
        prototype: {}
      }
    })

    expect(getCallCapability()).toMatchObject({
      state: 'unsupported_transform',
      transport: 'unsupported'
    })
  })
})
