import { describe, expect, it, vi } from 'vitest'
import {
  applyCallQualityProfileToSenders,
  buildCallAudioTrackConstraints,
  buildCallCaptureConstraints,
  buildCallVideoTrackConstraints,
  chooseCallQualityProfileWithHysteresis,
  DEFAULT_CALL_QUALITY_HYSTERESIS,
  deriveCallQualityIndicator,
  deriveCallTransportStatus,
  recommendCallQualityProfile
} from './call-quality-policy.ts'

function createSender(kind: 'audio' | 'video') {
  let parameters: RTCRtpSendParameters = {
    transactionId: 'initial',
    codecs: [],
    headerExtensions: [],
    rtcp: {},
    encodings: [{} as RTCRtpEncodingParameters]
  }

  return {
    track: { kind } as MediaStreamTrack,
    getParameters: vi.fn(() => ({
      ...parameters,
      encodings: [...(parameters.encodings ?? [])]
    })),
    setParameters: vi.fn(async (next: RTCRtpSendParameters) => {
      parameters = {
        ...next,
        encodings: [...(next.encodings ?? [])]
      }
    }),
    readParameters: () => parameters
  }
}

describe('call-quality-policy', () => {
  it('builds explicit capture constraints for audio/video calls', () => {
    expect(buildCallAudioTrackConstraints()).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    })

    expect(buildCallVideoTrackConstraints('medium')).toMatchObject({
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 24, max: 24 }
    })

    expect(buildCallCaptureConstraints('audio_video', 'low')).toMatchObject({
      audio: expect.objectContaining({ echoCancellation: true }),
      video: expect.objectContaining({
        width: { ideal: 640 },
        height: { ideal: 360 }
      })
    })
  })

  it('recommends lower profiles as network quality degrades', () => {
    expect(
      recommendCallQualityProfile({
        packetLossRate: 0.0,
        rttSeconds: 0.08,
        jitterSeconds: 0.005,
        availableOutgoingBitrate: 1_200_000,
        qualityLimitationReason: null,
        iceState: 'connected'
      })
    ).toBe('high')

    expect(
      recommendCallQualityProfile({
        packetLossRate: 0.04,
        rttSeconds: 0.3,
        jitterSeconds: 0.02,
        availableOutgoingBitrate: 600_000,
        qualityLimitationReason: 'bandwidth',
        iceState: 'connected'
      })
    ).toBe('medium')

    expect(
      recommendCallQualityProfile({
        packetLossRate: 0.0,
        rttSeconds: 0.001,
        jitterSeconds: 0.002,
        availableOutgoingBitrate: 300_000,
        qualityLimitationReason: 'none',
        iceState: 'connected'
      })
    ).toBe('high')

    expect(
      recommendCallQualityProfile({
        packetLossRate: 0.09,
        rttSeconds: 0.5,
        jitterSeconds: 0.04,
        availableOutgoingBitrate: 260_000,
        qualityLimitationReason: null,
        iceState: 'connected'
      })
    ).toBe('low')

    expect(
      recommendCallQualityProfile({
        packetLossRate: 0.16,
        rttSeconds: 0.8,
        jitterSeconds: 0.1,
        availableOutgoingBitrate: 100_000,
        qualityLimitationReason: null,
        iceState: 'connected'
      })
    ).toBe('audio_fallback')
  })

  it('applies hysteresis before changing profiles', () => {
    const first = chooseCallQualityProfileWithHysteresis(
      'high',
      'low',
      DEFAULT_CALL_QUALITY_HYSTERESIS
    )
    expect(first.transition).toBeNull()
    expect(first.profile).toBe('high')

    const second = chooseCallQualityProfileWithHysteresis(
      first.profile,
      'low',
      first.hysteresis
    )
    expect(second.transition?.direction).toBe('downgrade')
    expect(second.profile).toBe('medium')

    const third = chooseCallQualityProfileWithHysteresis(
      second.profile,
      'high',
      second.hysteresis
    )
    expect(third.transition).toBeNull()

    const fourth = chooseCallQualityProfileWithHysteresis(
      third.profile,
      'high',
      third.hysteresis
    )
    const fifth = chooseCallQualityProfileWithHysteresis(
      fourth.profile,
      'high',
      fourth.hysteresis
    )
    expect(fifth.transition?.direction).toBe('upgrade')
    expect(fifth.profile).toBe('high')
  })

  it('derives quality indicator from profile only', () => {
    expect(deriveCallQualityIndicator('high')).toBe('good')
    expect(deriveCallQualityIndicator('low')).toBe('fair')
    expect(deriveCallQualityIndicator('audio_fallback')).toBe('poor')
  })

  it('derives transport status independently with reconnect grace handling', () => {
    expect(
      deriveCallTransportStatus({
        reconnectState: 'idle',
        membraneClientConnected: true,
        iceState: 'connected'
      })
    ).toBe('connected')

    expect(
      deriveCallTransportStatus({
        reconnectState: 'reconnecting',
        membraneClientConnected: false,
        iceState: 'disconnected',
        disconnectedDurationMs: 1_000
      })
    ).toBe('reconnecting')

    expect(
      deriveCallTransportStatus({
        reconnectState: 'reconnecting',
        membraneClientConnected: false,
        iceState: 'disconnected',
        disconnectedDurationMs: 7_500
      })
    ).toBe('disconnected')

    expect(
      deriveCallTransportStatus({
        reconnectState: 'stable',
        membraneClientConnected: true,
        iceState: 'failed',
        disconnectedDurationMs: 200
      })
    ).toBe('disconnected')
  })

  it('updates sender encodings for the active profile', async () => {
    const audioSender = createSender('audio')
    const videoSender = createSender('video')

    await applyCallQualityProfileToSenders(
      [audioSender, videoSender] as unknown as RTCRtpSender[],
      'audio_fallback'
    )

    const audioEncoding = audioSender.readParameters().encodings?.[0]
    const videoEncoding = videoSender.readParameters().encodings?.[0]

    expect(audioEncoding?.maxBitrate).toBe(40_000)
    expect(videoEncoding?.maxBitrate).toBe(90_000)
    expect(videoEncoding?.maxFramerate).toBe(5)
    expect(videoEncoding?.active).toBe(false)
  })
})
