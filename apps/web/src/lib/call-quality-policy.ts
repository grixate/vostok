export type CallQualityProfile = 'high' | 'medium' | 'low' | 'audio_fallback'

export type CallQualityIndicator = 'good' | 'fair' | 'poor'

export type CallTransportStatus = 'connected' | 'reconnecting' | 'disconnected'

export type CallQualityTransitionDirection = 'upgrade' | 'downgrade'

export type CallQualityRecommendationInput = {
  packetLossRate: number
  rttSeconds: number | null
  jitterSeconds: number | null
  availableOutgoingBitrate: number | null
  qualityLimitationReason: string | null
  iceState: RTCIceConnectionState | null
}

export type CallQualityHysteresisState = {
  consecutiveDowngrades: number
  consecutiveUpgrades: number
}

export type CallQualityTransition = {
  previousProfile: CallQualityProfile
  nextProfile: CallQualityProfile
  direction: CallQualityTransitionDirection
}

export type CallQualityTransitionDecision = {
  profile: CallQualityProfile
  hysteresis: CallQualityHysteresisState
  transition: CallQualityTransition | null
}

export type CallTransportStatusInput = {
  reconnectState: 'idle' | 'reconnecting' | 'stable'
  membraneClientConnected: boolean
  iceState: RTCIceConnectionState | null
  disconnectedDurationMs?: number
}

type SenderProfileSettings = {
  audioMaxBitrate: number
  videoMaxBitrate: number
  videoMaxFramerate: number
  videoScaleResolutionDownBy: number
  videoActive: boolean
}

type MutableSender = {
  track?: MediaStreamTrack | null
  getParameters: () => RTCRtpSendParameters
  setParameters: (parameters: RTCRtpSendParameters) => Promise<void>
}

const PROFILE_RANK: Record<CallQualityProfile, number> = {
  audio_fallback: 0,
  low: 1,
  medium: 2,
  high: 3
}

const PROFILE_SETTINGS: Record<CallQualityProfile, SenderProfileSettings> = {
  high: {
    audioMaxBitrate: 64_000,
    videoMaxBitrate: 1_600_000,
    videoMaxFramerate: 30,
    videoScaleResolutionDownBy: 1,
    videoActive: true
  },
  medium: {
    audioMaxBitrate: 56_000,
    videoMaxBitrate: 900_000,
    videoMaxFramerate: 24,
    videoScaleResolutionDownBy: 1.35,
    videoActive: true
  },
  low: {
    audioMaxBitrate: 48_000,
    videoMaxBitrate: 380_000,
    videoMaxFramerate: 15,
    videoScaleResolutionDownBy: 2.2,
    videoActive: true
  },
  audio_fallback: {
    audioMaxBitrate: 40_000,
    videoMaxBitrate: 90_000,
    videoMaxFramerate: 5,
    videoScaleResolutionDownBy: 4,
    videoActive: false
  }
}

const ICE_RECONNECTING_GRACE_MS = 6_000

export const DEFAULT_CALL_QUALITY_HYSTERESIS: CallQualityHysteresisState = {
  consecutiveDowngrades: 0,
  consecutiveUpgrades: 0
}

export function buildCallAudioTrackConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  }
}

export function buildCallVideoTrackConstraints(
  profile: Exclude<CallQualityProfile, 'audio_fallback'> = 'high',
  deviceId?: string
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 }
  }

  if (profile === 'medium') {
    base.width = { ideal: 960 }
    base.height = { ideal: 540 }
    base.frameRate = { ideal: 24, max: 24 }
  } else if (profile === 'low') {
    base.width = { ideal: 640 }
    base.height = { ideal: 360 }
    base.frameRate = { ideal: 15, max: 15 }
  }

  if (deviceId) {
    base.deviceId = { exact: deviceId }
  }

  return base
}

export function buildCallCaptureConstraints(
  mode: 'audio' | 'audio_video',
  videoProfile: Exclude<CallQualityProfile, 'audio_fallback'> = 'high'
): MediaStreamConstraints {
  if (mode === 'audio') {
    return {
      audio: buildCallAudioTrackConstraints(),
      video: false
    }
  }

  return {
    audio: buildCallAudioTrackConstraints(),
    video: buildCallVideoTrackConstraints(videoProfile)
  }
}

export function deriveCallQualityIndicator(
  profile: CallQualityProfile
): CallQualityIndicator {
  return indicatorForProfile(profile)
}

function indicatorForProfile(profile: CallQualityProfile): CallQualityIndicator {
  if (profile === 'high') {
    return 'good'
  }

  if (profile === 'medium' || profile === 'low') {
    return 'fair'
  }

  return 'poor'
}

export function deriveCallTransportStatus({
  reconnectState,
  membraneClientConnected,
  iceState,
  disconnectedDurationMs = 0
}: CallTransportStatusInput): CallTransportStatus {
  const disconnectedBeyondGrace = disconnectedDurationMs >= ICE_RECONNECTING_GRACE_MS

  if (iceState === 'failed' || iceState === 'closed') {
    return 'disconnected'
  }

  if (iceState === 'disconnected') {
    return disconnectedBeyondGrace ? 'disconnected' : 'reconnecting'
  }

  if (iceState === 'new' || iceState === 'checking') {
    return 'reconnecting'
  }

  if (!membraneClientConnected || reconnectState === 'reconnecting') {
    return disconnectedBeyondGrace ? 'disconnected' : 'reconnecting'
  }

  return 'connected'
}

export function recommendCallQualityProfile(
  input: CallQualityRecommendationInput
): CallQualityProfile {
  const bitrateConstrainedSignal =
    input.availableOutgoingBitrate !== null &&
    (
      input.qualityLimitationReason === 'bandwidth' ||
      input.packetLossRate >= 0.02 ||
      (input.rttSeconds !== null && input.rttSeconds >= 0.2) ||
      (input.jitterSeconds !== null && input.jitterSeconds >= 0.02)
    )

  const isBitrateBelow = (threshold: number): boolean =>
    bitrateConstrainedSignal &&
    input.availableOutgoingBitrate !== null &&
    input.availableOutgoingBitrate < threshold

  if (input.iceState === 'failed') {
    return 'audio_fallback'
  }

  if (input.iceState === 'disconnected' || input.iceState === 'checking') {
    return 'low'
  }

  if (
    input.packetLossRate >= 0.12 ||
    (input.rttSeconds !== null && input.rttSeconds >= 0.65) ||
    (input.jitterSeconds !== null && input.jitterSeconds >= 0.08) ||
    isBitrateBelow(140_000)
  ) {
    return 'audio_fallback'
  }

  if (
    input.packetLossRate >= 0.07 ||
    (input.rttSeconds !== null && input.rttSeconds >= 0.45) ||
    (input.jitterSeconds !== null && input.jitterSeconds >= 0.05) ||
    isBitrateBelow(320_000)
  ) {
    return 'low'
  }

  if (
    input.packetLossRate >= 0.03 ||
    (input.rttSeconds !== null && input.rttSeconds >= 0.25) ||
    (input.jitterSeconds !== null && input.jitterSeconds >= 0.03) ||
    isBitrateBelow(700_000) ||
    input.qualityLimitationReason === 'bandwidth' ||
    input.qualityLimitationReason === 'cpu'
  ) {
    return 'medium'
  }

  return 'high'
}

export function chooseCallQualityProfileWithHysteresis(
  currentProfile: CallQualityProfile,
  recommendedProfile: CallQualityProfile,
  hysteresis: CallQualityHysteresisState
): CallQualityTransitionDecision {
  const currentRank = PROFILE_RANK[currentProfile]
  const recommendedRank = PROFILE_RANK[recommendedProfile]

  if (recommendedRank === currentRank) {
    return {
      profile: currentProfile,
      hysteresis: DEFAULT_CALL_QUALITY_HYSTERESIS,
      transition: null
    }
  }

  if (recommendedRank < currentRank) {
    const nextHysteresis: CallQualityHysteresisState = {
      consecutiveDowngrades: hysteresis.consecutiveDowngrades + 1,
      consecutiveUpgrades: 0
    }
    const immediateFallback = recommendedProfile === 'audio_fallback'
    const downgradeThreshold = immediateFallback ? 1 : 2

    if (nextHysteresis.consecutiveDowngrades < downgradeThreshold) {
      return {
        profile: currentProfile,
        hysteresis: nextHysteresis,
        transition: null
      }
    }

    const nextProfile = stepTowardsWorseProfile(currentProfile, recommendedProfile)

    return {
      profile: nextProfile,
      hysteresis: DEFAULT_CALL_QUALITY_HYSTERESIS,
      transition: {
        previousProfile: currentProfile,
        nextProfile,
        direction: 'downgrade'
      }
    }
  }

  const nextHysteresis: CallQualityHysteresisState = {
    consecutiveDowngrades: 0,
    consecutiveUpgrades: hysteresis.consecutiveUpgrades + 1
  }

  if (nextHysteresis.consecutiveUpgrades < 3) {
    return {
      profile: currentProfile,
      hysteresis: nextHysteresis,
      transition: null
    }
  }

  const nextProfile = stepTowardsBetterProfile(currentProfile, recommendedProfile)

  return {
    profile: nextProfile,
    hysteresis: DEFAULT_CALL_QUALITY_HYSTERESIS,
    transition: {
      previousProfile: currentProfile,
      nextProfile,
      direction: 'upgrade'
    }
  }
}

export function describeCallQualityProfile(profile: CallQualityProfile): string {
  switch (profile) {
    case 'high':
      return 'high-quality video'
    case 'medium':
      return 'balanced video'
    case 'low':
      return 'low-bandwidth video'
    case 'audio_fallback':
      return 'audio-priority mode'
    default:
      return 'balanced video'
  }
}

export async function applyCallQualityProfileToPeerConnection(
  peerConnection: RTCPeerConnection | null,
  profile: CallQualityProfile
): Promise<void> {
  if (!peerConnection) {
    return
  }

  await applyCallQualityProfileToSenders(peerConnection.getSenders(), profile)
}

export async function applyCallQualityProfileToSenders(
  senders: ReadonlyArray<RTCRtpSender>,
  profile: CallQualityProfile
): Promise<void> {
  const settings = PROFILE_SETTINGS[profile]

  await Promise.allSettled(
    senders.map(async (sender) => {
      const mutableSender = sender as unknown as MutableSender
      const kind = mutableSender.track?.kind

      if (kind !== 'audio' && kind !== 'video') {
        return
      }

      const parameters = mutableSender.getParameters()
      const encodings = parameters.encodings && parameters.encodings.length > 0
        ? [...parameters.encodings]
        : [{} as RTCRtpEncodingParameters]

      if (kind === 'audio') {
        for (const encoding of encodings) {
          encoding.maxBitrate = settings.audioMaxBitrate
        }
      } else {
        for (const encoding of encodings) {
          encoding.maxBitrate = settings.videoMaxBitrate
          encoding.maxFramerate = settings.videoMaxFramerate
          encoding.active = settings.videoActive

          if (settings.videoScaleResolutionDownBy > 1) {
            encoding.scaleResolutionDownBy = settings.videoScaleResolutionDownBy
          } else {
            delete encoding.scaleResolutionDownBy
          }
        }

        parameters.degradationPreference =
          profile === 'high' ? 'balanced' : 'maintain-framerate'
      }

      parameters.encodings = encodings
      await mutableSender.setParameters(parameters)
    })
  )
}

function stepTowardsWorseProfile(
  currentProfile: CallQualityProfile,
  recommendedProfile: CallQualityProfile
): CallQualityProfile {
  const ordered: CallQualityProfile[] = ['high', 'medium', 'low', 'audio_fallback']
  const currentIndex = ordered.indexOf(currentProfile)
  const recommendedIndex = ordered.indexOf(recommendedProfile)

  if (recommendedIndex >= currentIndex) {
    return ordered[Math.min(currentIndex + 1, ordered.length - 1)] ?? currentProfile
  }

  return currentProfile
}

function stepTowardsBetterProfile(
  currentProfile: CallQualityProfile,
  recommendedProfile: CallQualityProfile
): CallQualityProfile {
  const ordered: CallQualityProfile[] = ['audio_fallback', 'low', 'medium', 'high']
  const currentIndex = ordered.indexOf(currentProfile)
  const recommendedIndex = ordered.indexOf(recommendedProfile)

  if (recommendedIndex >= currentIndex) {
    return ordered[Math.min(currentIndex + 1, ordered.length - 1)] ?? currentProfile
  }

  return currentProfile
}
