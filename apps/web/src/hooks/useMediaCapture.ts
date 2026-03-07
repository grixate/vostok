import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { AttachmentDescriptor } from '../types'
import {
  appendMediaUploadPart,
  completeMediaUpload,
  createMediaUpload,
  fetchMediaUploadState,
  createMessage
} from '../lib/api'
import { encryptAttachmentFile, generateAttachmentThumbnailDataUrl, generateAttachmentWaveform } from '../lib/attachment-vault'
import { base64ToBytes, bytesToBase64 } from '../lib/base64'
import { sha256Hex } from '@vostok/crypto-core'
import type { CachedMessage } from '../lib/message-cache'
import { mergeMessageThread } from '../utils/message-helpers'
import { inferMediaKind } from '../utils/attachment-helpers'
import { shouldQueueOutboxSendFailure } from '../utils/crypto-helpers'
import { useAppContext } from '../contexts/AppContext'
import type { ChatMessage } from '../lib/api'

export type UseMediaCaptureParams = {
  activeChatId: string | null
  messageItemsRef: React.RefObject<CachedMessage[]>
  replaceActiveMessages: (chatId: string, nextMessages: CachedMessage[], syncSummary: boolean) => void
  ingestMessageIntoActiveThread: (message: ChatMessage, chatId: string) => Promise<void>
  buildEncryptedMessagePayload: (
    plainText: string,
    chatId: string,
    clientId: string,
    messageKind: 'text' | 'attachment',
    replyToMessageId?: string | null
  ) => Promise<{ payload: any; deliveryMode: 'group_sender_key' | 'session' }>
  queueMessageForOutbox: (
    chatId: string,
    payload: any,
    lastError: string
  ) => Promise<void>
  replyTargetMessageId: string | null
  setReplyTargetMessageId: React.Dispatch<React.SetStateAction<string | null>>
}

export function useMediaCapture(params: UseMediaCaptureParams) {
  const { storedDevice, setBanner, setLoading } = useAppContext()
  const {
    activeChatId,
    messageItemsRef,
    replaceActiveMessages,
    ingestMessageIntoActiveThread,
    buildEncryptedMessagePayload,
    queueMessageForOutbox,
    replyTargetMessageId,
    setReplyTargetMessageId
  } = params

  const [voiceNoteRecording, setVoiceNoteRecording] = useState(false)
  const [roundVideoRecording, setRoundVideoRecording] = useState(false)

  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceNoteStreamRef = useRef<MediaStream | null>(null)
  const voiceNoteChunksRef = useRef<Blob[]>([])
  const roundVideoRecorderRef = useRef<MediaRecorder | null>(null)
  const roundVideoStreamRef = useRef<MediaStream | null>(null)
  const roundVideoChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    },
    []
  )

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
    setBanner({ tone: 'info', message: 'Encrypting and uploading attachment...' })

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

      setBanner({ tone: 'info', message: 'Finishing voice note...' })
      recorder.stop()
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
      setBanner({ tone: 'info', message: 'Recording voice note... tap again to stop.' })
    } catch (error) {
      cleanupVoiceNoteCapture()
      const message = error instanceof Error ? error.message : 'Failed to start voice note recording.'
      setBanner({ tone: 'error', message })
    }
  }

  async function handleRoundVideoToggle() {
    if (roundVideoRecording) {
      const recorder = roundVideoRecorderRef.current

      if (!recorder) {
        cleanupRoundVideoCapture()
        return
      }

      setBanner({ tone: 'info', message: 'Finishing round video...' })
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
      setBanner({ tone: 'info', message: 'Recording round video... tap again to stop.' })
    } catch (error) {
      cleanupRoundVideoCapture()
      const message = error instanceof Error ? error.message : 'Failed to start round video recording.'
      setBanner({ tone: 'error', message })
    }
  }

  return {
    voiceNoteRecording,
    roundVideoRecording,
    fileInputRef,
    sendAttachmentFile,
    handleAttachmentPick,
    handleVoiceNoteToggle,
    handleRoundVideoToggle
  }
}
