import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import { sha256Hex } from '@vostok/crypto-core'
import {
  appendMediaUploadPart,
  completeMediaUpload,
  confirmMediaDelivery,
  createMessage,
  createMediaUpload,
  fetchMediaUpload,
  fetchMediaUploadState
} from '../lib/api.ts'
import {
  decryptAttachmentFile,
  encryptAttachmentFile,
  generateAttachmentThumbnailDataUrl,
  generateAttachmentWaveform
} from '../lib/attachment-vault.ts'
import { base64ToBytes, bytesToBase64 } from '../lib/base64.ts'
import { mergeMessageThread, cacheSentPlaintext } from '../utils/message-helpers.ts'
import { inferMediaKind } from '../utils/attachment-helpers.ts'
import { shouldQueueOutboxSendFailure } from '../utils/crypto-helpers.ts'
import type { CachedMessage } from '../lib/message-cache.ts'
import type { AttachmentDescriptor } from '../types.ts'

export function useMediaCapture(
  activeChatId: string | null,
  messageItemsRef: React.RefObject<CachedMessage[]>,
  replaceActiveMessages: (chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) => void,
  ingestMessageIntoActiveThread: (message: import('../lib/api.ts').ChatMessage, chatId: string) => Promise<void>,
  buildEncryptedMessagePayload: (
    plainText: string,
    chatId: string,
    clientId: string,
    messageKind: 'text' | 'attachment',
    replyToMessageId?: string | null
  ) => Promise<{
    payload: {
      client_id: string
      ciphertext: string
      message_kind: string
      header?: string
      crypto_scheme?: string
      sender_key_id?: string
      sender_key_epoch?: number
      reply_to_message_id?: string
      recipient_envelopes?: Record<string, string>
      established_session_ids?: string[]
    }
    deliveryMode: 'group_sender_key' | 'session'
  }>,
  queueMessageForOutbox: (
    chatId: string,
    payload: {
      client_id: string
      ciphertext: string
      message_kind: string
      header?: string
      crypto_scheme?: string
      sender_key_id?: string
      sender_key_epoch?: number
      reply_to_message_id?: string
      recipient_envelopes?: Record<string, string>
      established_session_ids?: string[]
    },
    lastError: string
  ) => Promise<void>,
  replyTargetMessageId: string | null,
  setReplyTargetMessageId: React.Dispatch<React.SetStateAction<string | null>>
) {
  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
  // Keep a ref to the latest token so async callbacks (recorder.onstop)
  // always use the current token, even if it refreshed during recording.
  const sessionTokenRef = useRef(sessionToken)
  sessionTokenRef.current = sessionToken
  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [roundVideoRecording, setRoundVideoRecording] = useState(false)
  const [attachmentPlaybackUrls, setAttachmentPlaybackUrls] = useState<Record<string, string>>({})
  const [expiredMediaIds, setExpiredMediaIds] = useState<Set<string>>(new Set())
  const [voiceRecordingDuration, setVoiceRecordingDuration] = useState(0)

  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceNoteStreamRef = useRef<MediaStream | null>(null)
  const voiceNoteChunksRef = useRef<Blob[]>([])
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null)
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const videoAnalyserRef = useRef<AnalyserNode | null>(null)
  const videoAudioContextRef = useRef<AudioContext | null>(null)
  const roundVideoRecorderRef = useRef<MediaRecorder | null>(null)
  const roundVideoStreamRef = useRef<MediaStream | null>(null)
  const roundVideoChunksRef = useRef<Blob[]>([])
  const roundVideoThumbnailRef = useRef<string | null>(null)
  const attachmentPlaybackUrlsRef = useRef<Record<string, string>>({})
  const attachmentPlaybackInFlightRef = useRef<Map<string, Promise<string>>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const voiceRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    attachmentPlaybackUrlsRef.current = attachmentPlaybackUrls
  }, [attachmentPlaybackUrls])

  // Cleanup on unmount
  useEffect(
    () => () => {
      voiceNoteRecorderRef.current = null
      voiceNoteChunksRef.current = []

      if (voiceNoteStreamRef.current) {
        for (const track of voiceNoteStreamRef.current.getTracks()) {
          track.stop()
        }
      }

      voiceNoteStreamRef.current = null

      roundVideoRecorderRef.current = null
      roundVideoChunksRef.current = []

      if (roundVideoStreamRef.current) {
        for (const track of roundVideoStreamRef.current.getTracks()) {
          track.stop()
        }
      }

      roundVideoStreamRef.current = null

      for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
        URL.revokeObjectURL(playbackUrl)
      }

      attachmentPlaybackUrlsRef.current = {}
      attachmentPlaybackInFlightRef.current.clear()
    },
    []
  )

  // Clear playback URLs on chat change
  useEffect(() => {
    for (const playbackUrl of Object.values(attachmentPlaybackUrlsRef.current)) {
      URL.revokeObjectURL(playbackUrl)
    }

    attachmentPlaybackInFlightRef.current.clear()
    attachmentPlaybackUrlsRef.current = {}
    setAttachmentPlaybackUrls({})
  }, [activeChatId])

  function cleanupVoiceNoteCapture() {
    voiceNoteRecorderRef.current = null
    voiceNoteChunksRef.current = []

    if (voiceNoteStreamRef.current) {
      for (const track of voiceNoteStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    voiceNoteStreamRef.current = null
    voiceAnalyserRef.current = null
    if (voiceAudioContextRef.current) {
      void voiceAudioContextRef.current.close().catch(() => undefined)
      voiceAudioContextRef.current = null
    }
    if (voiceRecordingTimerRef.current) {
      clearInterval(voiceRecordingTimerRef.current)
      voiceRecordingTimerRef.current = null
    }
    setVoiceRecordingDuration(0)
    setVoiceNoteRecording(false)
  }

  async function discardVoiceNoteRecording() {
    const recorder = voiceNoteRecorderRef.current

    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
    }

    cleanupVoiceNoteCapture()
  }

  function cleanupRoundVideoCapture() {
    roundVideoRecorderRef.current = null
    roundVideoChunksRef.current = []

    if (roundVideoStreamRef.current) {
      for (const track of roundVideoStreamRef.current.getTracks()) {
        track.stop()
      }
    }

    roundVideoStreamRef.current = null
    videoAnalyserRef.current = null
    if (videoAudioContextRef.current) {
      void videoAudioContextRef.current.close().catch(() => undefined)
      videoAudioContextRef.current = null
    }
    setRoundVideoRecording(false)
  }

  async function uploadEncryptedAttachmentMultipart(
    sessionToken: string,
    fileName: string,
    mediaKind: 'file' | 'image' | 'audio' | 'video',
    encryptedAttachment: {
      contentType: string
      size: number
      ciphertextBase64: string
    }
  ): Promise<string> {
    const ciphertextBytes = base64ToBytes(encryptedAttachment.ciphertextBase64)
    const chunkByteSize = 192 * 1024
    const partCount = Math.max(1, Math.ceil(ciphertextBytes.byteLength / chunkByteSize))
    const createUploadResponse = await createMediaUpload(sessionToken, {
      filename: fileName,
      content_type: encryptedAttachment.contentType,
      declared_byte_size: encryptedAttachment.size,
      media_kind: mediaKind,
      expected_part_count: partCount
    })
    const uploadId = createUploadResponse.upload.id
    let uploadedPartIndexes = new Set<number>(createUploadResponse.upload.uploaded_part_indexes ?? [])

    const uploadPartByIndex = async (partIndex: number) => {
      const start = partIndex * chunkByteSize
      const end = Math.min(start + chunkByteSize, ciphertextBytes.byteLength)
      const chunk = ciphertextBytes.subarray(start, end)
      const response = await appendMediaUploadPart(sessionToken, uploadId, {
        chunk: bytesToBase64(chunk),
        part_index: partIndex,
        part_count: partCount
      })
      uploadedPartIndexes = new Set(response.upload.uploaded_part_indexes ?? [])
    }

    for (let pass = 0; pass < 3; pass += 1) {
      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        if (uploadedPartIndexes.has(partIndex)) {
          continue
        }

        try {
          await uploadPartByIndex(partIndex)
        } catch (error) {
          if (pass >= 2) {
            throw error
          }

          const snapshot = await fetchMediaUploadState(sessionToken, uploadId)
          uploadedPartIndexes = new Set(snapshot.upload.uploaded_part_indexes ?? [])
        }
      }

      if (uploadedPartIndexes.size >= partCount) {
        break
      }
    }

    if (uploadedPartIndexes.size < partCount) {
      throw new Error('Attachment upload is missing one or more encrypted chunks.')
    }

    const ciphertextSha256 = await sha256Hex(ciphertextBytes)

    await completeMediaUpload(sessionToken, uploadId, {
      ciphertext_sha256: ciphertextSha256
    })
    return uploadId
  }

  async function sendAttachmentFile(file: File) {
    const token = sessionTokenRef.current
    if (!token || !activeChatId) {
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment\u2026' })

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    let thumbnailDataUrl: string | null = null
    let waveform: number[] | null = null

    // For round videos, prefer the live-stream thumbnail captured directly
    // from the camera before recording stopped — the WebM file-based
    // extraction often produces a blank or tiny first frame.
    if (roundVideoThumbnailRef.current) {
      thumbnailDataUrl = roundVideoThumbnailRef.current
      roundVideoThumbnailRef.current = null
    } else {
      try {
        thumbnailDataUrl = await generateAttachmentThumbnailDataUrl(file)
      } catch {
        thumbnailDataUrl = null
      }
    }

    try {
      waveform = await generateAttachmentWaveform(file)
    } catch {
      waveform = null
    }

    const optimisticAttachment = {
      uploadId: 'pending',
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      thumbnailDataUrl: thumbnailDataUrl ?? undefined,
      waveform: waveform ?? undefined
    }
    const optimisticMessage: CachedMessage = {
      id: optimisticId,
      clientId,
      replyToMessageId: activeReplyToMessageId ?? undefined,
      text: `Attachment: ${file.name}`,
      sentAt: new Date().toISOString(),
      side: 'outgoing',
      senderId: storedDevice?.deviceId,
      senderUsername: storedDevice?.username,
      decryptable: true,
      attachment: optimisticAttachment
    }

    // Create a local blob URL for immediate playback of voice/video messages
    const isVoiceOrVideo = file.name.startsWith('voice-note-') || file.name.startsWith('round-video-')
    let localBlobUrl: string | null = null
    if (isVoiceOrVideo) {
      localBlobUrl = URL.createObjectURL(file)
      // Store under the 'pending' uploadId so the message thread can find it
      setAttachmentPlaybackUrls((prev) => ({ ...prev, pending: localBlobUrl! }))
    }

    console.log('[sendAttachmentFile] inserting optimistic:', optimisticId, 'clientId:', clientId)
    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setReplyTargetMessageId(null)

    try {
      const encryptedAttachment = await encryptAttachmentFile(file)
      const uploadId = await uploadEncryptedAttachmentMultipart(
        sessionTokenRef.current!,
        file.name,
        inferMediaKind(file.type),
        encryptedAttachment
      )

      const descriptor: AttachmentDescriptor = {
        kind: 'attachment',
        uploadId,
        fileName: file.name,
        contentType: encryptedAttachment.contentType,
        size: encryptedAttachment.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        waveform: waveform ?? undefined,
        contentKeyBase64: encryptedAttachment.contentKeyBase64,
        ivBase64: encryptedAttachment.ivBase64
      }

      // Update the optimistic message with real attachment details so it exits
      // the "Sending…" spinner immediately while the message is still in-flight.
      const updatedOptimistic: CachedMessage = {
        ...optimisticMessage,
        attachment: {
          ...optimisticAttachment,
          uploadId,
          contentKeyBase64: encryptedAttachment.contentKeyBase64,
          ivBase64: encryptedAttachment.ivBase64
        }
      }
      replaceActiveMessages(
        activeChatId,
        mergeMessageThread(messageItemsRef.current, updatedOptimistic),
        false
      )

      // Migrate the blob URL from the 'pending' key to the real uploadId so
      // the playback URL lookup in MessageThread finds it immediately.
      if (localBlobUrl) {
        setAttachmentPlaybackUrls((prev) => {
          const next = { ...prev, [uploadId]: localBlobUrl }
          delete next.pending
          return next
        })
      }

      // Cache the sent attachment so that if decryption of our own message fails
      // (e.g. sender-key ratchet), the message still renders from the local cache.
      const attachmentText =
        file.type.startsWith('audio/') && file.name.startsWith('voice-note-')
          ? `Voice note: ${file.name}`
          : file.type.startsWith('video/') && file.name.startsWith('round-video-')
            ? `Round video: ${file.name}`
            : `Attachment: ${file.name}`
      cacheSentPlaintext(clientId, attachmentText, {
        uploadId,
        fileName: file.name,
        contentType: encryptedAttachment.contentType,
        size: encryptedAttachment.size,
        thumbnailDataUrl: thumbnailDataUrl ?? undefined,
        waveform: waveform ?? undefined,
        contentKeyBase64: encryptedAttachment.contentKeyBase64,
        ivBase64: encryptedAttachment.ivBase64
      })

      // Retry encryption setup — session bootstrap may need a moment
      const MAX_RETRIES = 4
      const RETRY_DELAY_MS = 1500
      let payload: Awaited<ReturnType<typeof buildEncryptedMessagePayload>>['payload'] | null = null
      let deliveryMode: string = ''
      let lastEncryptError: unknown = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await buildEncryptedMessagePayload(
            JSON.stringify(descriptor),
            activeChatId,
            clientId,
            'attachment',
            activeReplyToMessageId
          )
          payload = result.payload
          deliveryMode = result.deliveryMode
          break
        } catch (err) {
          lastEncryptError = err
          if (attempt < MAX_RETRIES - 1) {
            setBanner({ tone: 'info', message: 'Setting up encryption\u2026' })
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          }
        }
      }

      if (!payload) {
        console.error('[sendAttachmentFile] encryption failed after retries:', lastEncryptError)
        throw lastEncryptError ?? new Error('Failed to encrypt attachment.')
      }
      console.log('[sendAttachmentFile] encrypted OK, sending to server...')

      try {
        const response = await createMessage(sessionTokenRef.current!, activeChatId, payload)
        console.log('[sendAttachmentFile] server response:', response.message.id, 'client_id:', response.message.client_id)

        try {
          await ingestMessageIntoActiveThread(response.message, activeChatId)
          console.log('[sendAttachmentFile] ingested OK')
        } catch (ingestError) {
          // Message was sent successfully — don't remove the optimistic message.
          // The next channel sync or page reload will pick up the server version.
          console.warn('[sendAttachmentFile] ingest failed, keeping optimistic:', ingestError)
        }
        setBanner({
          tone: 'success',
          message:
            deliveryMode === 'group_sender_key'
              ? 'Encrypted attachment uploaded and delivered with Sender Key transport.'
              : 'Encrypted attachment uploaded and delivered with session transport.'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send attachment.'

        if (shouldQueueOutboxSendFailure(message)) {
          await queueMessageForOutbox(activeChatId, payload, message)
          setBanner({
            tone: 'info',
            message: 'Attachment message queued for offline replay. It will retry automatically.'
          })
          return
        }

        throw error
      }
    } catch (error) {
      console.error('[sendAttachmentFile] OUTER CATCH:', error)
      const message = error instanceof Error ? error.message : 'Failed to send attachment.'
      setBanner({ tone: 'error', message })
      setReplyTargetMessageId(activeReplyToMessageId)

      // Only remove the optimistic message for permanent failures.
      // Encryption setup failures are transient — keep the message visible.
      const isTransient = message.includes('Encryption') || message.includes('encryption') || message.includes('Setting up')
      if (!isTransient) {
        replaceActiveMessages(
          activeChatId,
          messageItemsRef.current.filter((item) => item.clientId !== clientId && item.id !== optimisticId),
          true
        )
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !sessionTokenRef.current || !activeChatId) {
      return
    }

    await sendAttachmentFile(file)
  }

  async function handleVoiceNoteToggle() {
    if (voiceNoteRecording) {
      const recorder = voiceNoteRecorderRef.current

      if (!recorder) {
        cleanupVoiceNoteCapture()
        return
      }

      recorder.stop()
      if (voiceRecordingTimerRef.current) {
        clearInterval(voiceRecordingTimerRef.current)
        voiceRecordingTimerRef.current = null
      }
      setVoiceRecordingDuration(0)
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      voiceNoteStreamRef.current = stream
      voiceNoteRecorderRef.current = recorder
      voiceNoteChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceNoteChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(voiceNoteChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        cleanupVoiceNoteCapture()

        if (blob.size === 0) {
          setBanner({ tone: 'error', message: 'Voice note recording was empty.' })
          return
        }

        const extension = (recorder.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
          type: recorder.mimeType || 'audio/webm'
        })

        void sendAttachmentFile(file)
      }

      // Set up AnalyserNode for live waveform visualization
      try {
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        voiceAudioContextRef.current = audioCtx
        voiceAnalyserRef.current = analyser
      } catch {
        // Audio context creation can fail — waveform will be decorative
      }

      recorder.start()
      setVoiceNoteRecording(true)
      setVoiceRecordingDuration(0)
      voiceRecordingTimerRef.current = setInterval(() => {
        setVoiceRecordingDuration((d) => d + 1)
      }, 1000)
    } catch (error) {
      cleanupVoiceNoteCapture()
      const message = error instanceof Error ? error.message : 'Failed to start voice note recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function _handleRoundVideoToggle() {
    if (roundVideoRecording) {
      const recorder = roundVideoRecorderRef.current

      if (!recorder) {
        cleanupRoundVideoCapture()
        return
      }

      // Capture a thumbnail from the live video stream before stopping.
      // This is more reliable than trying to decode the WebM file after.
      try {
        const stream = roundVideoStreamRef.current
        const videoTrack = stream?.getVideoTracks()[0]
        const imageCaptureCtor = (window as typeof window & {
          ImageCapture?: new (track: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> }
        }).ImageCapture
        if (videoTrack && imageCaptureCtor) {
          const capture = new imageCaptureCtor(videoTrack) as unknown as { grabFrame(): Promise<ImageBitmap> }
          const bitmap = await capture.grabFrame()
          const canvas = document.createElement('canvas')
          const maxEdge = 280
          const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            roundVideoThumbnailRef.current = canvas.toDataURL('image/jpeg', 0.78)
          }
          bitmap.close()
        }
      } catch {
        // Thumbnail capture failed — will fall back to file-based generation
      }

      setBanner({ tone: 'info', message: 'Finishing round video\u2026' })
      recorder.stop()
      return
    }

    if (!activeChatId) {
      setBanner({ tone: 'error', message: 'Create or select a chat first.' })
      return
    }

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 }
        }
      })
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      roundVideoStreamRef.current = stream
      roundVideoRecorderRef.current = recorder
      roundVideoChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          roundVideoChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(roundVideoChunksRef.current, { type: recorder.mimeType || 'video/webm' })
        cleanupRoundVideoCapture()

        if (blob.size === 0) {
          setBanner({ tone: 'error', message: 'Round video recording was empty.' })
          return
        }

        const file = new File([blob], `round-video-${Date.now()}.webm`, {
          type: recorder.mimeType || 'video/webm'
        })

        void sendAttachmentFile(file)
      }

      // Set up AnalyserNode for live waveform from video's audio track
      try {
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        videoAudioContextRef.current = audioCtx
        videoAnalyserRef.current = analyser
      } catch {
        // Audio context creation can fail — waveform will be static
      }

      recorder.start()
      setRoundVideoRecording(true)
      setBanner({ tone: 'info', message: 'Recording round video\u2026 tap again to stop.' })
    } catch (error) {
      cleanupRoundVideoCapture()
      const message = error instanceof Error ? error.message : 'Failed to start round video recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function ensureAttachmentPlaybackUrl(attachment: AttachmentDescriptor): Promise<string> {
    const existingUrl = attachmentPlaybackUrlsRef.current[attachment.uploadId]

    if (existingUrl) {
      return existingUrl
    }

    const inFlight = attachmentPlaybackInFlightRef.current.get(attachment.uploadId)

    if (inFlight) {
      return inFlight
    }

    if (!sessionTokenRef.current) {
      throw new Error('No session token is available.')
    }

    const promise = (async () => {
      let response: Awaited<ReturnType<typeof fetchMediaUpload>>
      try {
        response = await fetchMediaUpload(sessionTokenRef.current!, attachment.uploadId)
      } catch (fetchError) {
        // Check if this is a 410 Gone (media expired/evicted)
        const msg = fetchError instanceof Error ? fetchError.message : ''
        if (msg.includes('expired') || msg.includes('deleted') || msg.includes('media_expired')) {
          setExpiredMediaIds((prev) => new Set(prev).add(attachment.uploadId))
          throw new Error('Media has expired and is no longer available on the server.')
        }
        throw fetchError
      }

      if (!response.upload.ciphertext) {
        throw new Error('The encrypted attachment payload is missing on the server.')
      }

      const blob = await decryptAttachmentFile(
        response.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType
      )
      const playbackUrl = URL.createObjectURL(blob)

      // Confirm delivery — fire-and-forget so the server can track
      // which recipients have downloaded the media for eviction decisions.
      void confirmMediaDelivery(sessionTokenRef.current!, attachment.uploadId).catch(() => {})

      setAttachmentPlaybackUrls((current) => {
        const previous = current[attachment.uploadId]

        if (previous && previous !== playbackUrl) {
          URL.revokeObjectURL(previous)
        }

        return {
          ...current,
          [attachment.uploadId]: playbackUrl
        }
      })

      return playbackUrl
    })()

    attachmentPlaybackInFlightRef.current.set(attachment.uploadId, promise)

    try {
      return await promise
    } finally {
      attachmentPlaybackInFlightRef.current.delete(attachment.uploadId)
    }
  }

  async function handleDownloadAttachment(attachment: AttachmentDescriptor) {
    if (!sessionTokenRef.current) {
      setBanner({ tone: 'error', message: 'No session token is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: `Downloading ${attachment.fileName}\u2026` })

    try {
      const response = await fetchMediaUpload(sessionTokenRef.current!, attachment.uploadId)

      if (!response.upload.ciphertext) {
        throw new Error('The encrypted attachment payload is missing on the server.')
      }

      const blob = await decryptAttachmentFile(
        response.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      anchor.click()
      URL.revokeObjectURL(url)

      setBanner({ tone: 'success', message: `${attachment.fileName} downloaded and decrypted.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download attachment.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    voiceNoteRecording,
    roundVideoRecording,
    voiceRecordingDuration,
    setVoiceRecordingDuration,
    fileInputRef,
    voiceNoteRecorderRef,
    voiceRecordingTimerRef,
    voiceAnalyserRef,
    videoAnalyserRef,
    roundVideoStreamRef,
    attachmentPlaybackUrls,
    expiredMediaIds,
    cleanupVoiceNoteCapture,
    discardVoiceNoteRecording,
    sendAttachmentFile,
    handleAttachmentPick,
    handleVoiceNoteToggle,
    handleRoundVideoToggle: _handleRoundVideoToggle,
    ensureAttachmentPlaybackUrl,
    handleDownloadAttachment
  }
}
