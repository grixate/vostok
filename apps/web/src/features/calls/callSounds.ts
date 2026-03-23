// Call audio feedback — uses Web Audio API to generate tones
// rather than requiring audio files.

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext()
  }
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
  return audioContext
}

function playTone(frequency: number, durationMs: number, type: OscillatorType = 'sine', gain = 0.15) {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') return
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.type = type
    osc.frequency.value = frequency
    vol.gain.value = gain
    osc.connect(vol)
    vol.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + durationMs / 1000)
  } catch {
    // Audio not available
  }
}

let ringInterval: ReturnType<typeof setInterval> | null = null

export function playRingtone() {
  stopRingtone()
  function ring() {
    playTone(440, 200)
    setTimeout(() => playTone(520, 200), 250)
  }
  ring()
  ringInterval = setInterval(ring, 3000)
}

export function stopRingtone() {
  if (ringInterval) {
    clearInterval(ringInterval)
    ringInterval = null
  }
}

let ringbackInterval: ReturnType<typeof setInterval> | null = null

export function playRingback() {
  stopRingback()
  function ring() {
    playTone(440, 1000, 'sine', 0.08)
  }
  ring()
  ringbackInterval = setInterval(ring, 4000)
}

export function stopRingback() {
  if (ringbackInterval) {
    clearInterval(ringbackInterval)
    ringbackInterval = null
  }
}

export function playConnectSound() {
  playTone(600, 100)
  setTimeout(() => playTone(800, 150), 120)
}

export function playDisconnectSound() {
  playTone(400, 150)
  setTimeout(() => playTone(300, 200), 170)
}

export function playBusyTone() {
  let count = 0
  const interval = setInterval(() => {
    playTone(480, 300, 'sine', 0.12)
    count++
    if (count >= 4) clearInterval(interval)
  }, 500)
}

export function cleanupAudio() {
  stopRingtone()
  stopRingback()
  if (audioContext && audioContext.state !== 'closed') {
    void audioContext.close()
  }
  audioContext = null
}
