import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import { sha256Hex } from '@vostok/crypto-core'
import {
  appendMediaUploadPart,
  completeMediaUpload,
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
import { mergeMessageThread } from '../utils/message-helpers.ts'
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
  const { storedDevice, loading, setLoading, setBanner } = useAppContext()
  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [roundVideoRecording, setRoundVideoRecording] = useState(false)
  const [attachmentPlaybackUrls, setAttachmentPlaybackUrls] = useState<Record<string, string>>({})
  const [voiceRecordingDuration, setVoiceRecordingDuration] = useState(0)

  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceNoteStreamRef = useRef<MediaStream | null>(null)
  const voiceNoteChunksRef = useRef<Blob[]>([])
  const roundVideoRecorderRef = useRef<MediaRecorder | null>(null)
  const roundVideoStreamRef = useRef<MediaStream | null>(null)
  const roundVideoChunksRef = useRef<Blob[]>([])
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
    setVoiceNoteRecording(false)
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
    if (!storedDevice || !activeChatId) {
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment\u2026' })

    const clientId = window.crypto.randomUUID()
    const optimisticId = `optimistic-${clientId}`
    const activeReplyToMessageId = replyTargetMessageId
    let thumbnailDataUrl: string | null = null
    let waveform: number[] | null = null

    try {
      thumbnailDataUrl = await generateAttachmentThumbnailDataUrl(file)
    } catch {
      thumbnailDataUrl = null
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
      decryptable: true,
      attachment: optimisticAttachment
    }

    replaceActiveMessages(activeChatId, mergeMessageThread(messageItemsRef.current, optimisticMessage), true)
    setReplyTargetMessageId(null)

    try {
      const encryptedAttachment = await encryptAttachmentFile(file)
      const uploadId = await uploadEncryptedAttachmentMultipart(
        storedDevice.sessionToken,
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

      const { payload, deliveryMode } = await buildEncryptedMessagePayload(
        JSON.stringify(descriptor),
        activeChatId,
        clientId,
        'attachment',
        activeReplyToMessageId
      )

      try {
        const { createMessage } = await import('../lib/api.ts')
        const response = await createMessage(storedDevice.sessionToken, activeChatId, payload)

        await ingestMessageIntoActiveThread(response.message, activeChatId)
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
      const message = error instanceof Error ? error.message : 'Failed to send attachment.'
      setBanner({ tone: 'error', message })
      setReplyTargetMessageId(activeReplyToMessageId)
      replaceActiveMessages(
        activeChatId,
        messageItemsRef.current.filter((item) => item.clientId !== clientId && item.id !== optimisticId),
        true
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !storedDevice || !activeChatId) {
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

    if (!storedDevice) {
      throw new Error('No local device identity is available.')
    }

    const promise = (async () => {
      const response = await fetchMediaUpload(storedDevice.sessionToken, attachment.uploadId)

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
    if (!storedDevice) {
      setBanner({ tone: 'error', message: 'No local device identity is available.' })
      return
    }

    setLoading(true)
    setBanner({ tone: 'info', message: `Downloading ${attachment.fileName}\u2026` })

    try {
      const response = await fetchMediaUpload(storedDevice.sessionToken, attachment.uploadId)

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
    roundVideoStreamRef,
    cleanupVoiceNoteCapture,
    sendAttachmentFile,
    handleAttachmentPick,
    handleVoiceNoteToggle,
    handleRoundVideoToggle: _handleRoundVideoToggle,
    ensureAttachmentPlaybackUrl,
    handleDownloadAttachment
  }
}
