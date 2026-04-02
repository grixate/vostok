import type {
  AttachmentDescriptor,
  AttachmentDownloadState,
  AutoDownloadSettings,
  AutoDownloadChatConfig,
} from '../types.ts'
import { inferMediaKindForDownload } from '../utils/attachment-helpers.ts'
import { decryptAttachmentFile } from './attachment-vault.ts'
import { confirmMediaDelivery } from './api.ts'
import { buildApiRoot } from './api-request.ts'
import { formatBytes } from './client-storage.ts'

// ─── Defaults ──────────────────────────────────────────────────────────────────

const MB = 1024 * 1024

const DEFAULT_CHAT_CONFIG: AutoDownloadChatConfig = {
  photos:         { max_size_bytes: 5 * MB,  on_cellular: true },
  videos:         { max_size_bytes: 0,       on_cellular: false },
  files:          { max_size_bytes: 0,       on_cellular: false },
  voice_messages: { max_size_bytes: 5 * MB,  on_cellular: true },
  round_videos:   { max_size_bytes: 0,       on_cellular: false },
}

export const DEFAULT_AUTO_DOWNLOAD: AutoDownloadSettings = {
  private_chats: { ...DEFAULT_CHAT_CONFIG },
  group_chats:   { ...DEFAULT_CHAT_CONFIG },
}

// ─── Network detection ─────────────────────────────────────────────────────────

type NetworkInfo = { saveData?: boolean; effectiveType?: string }

export function isMeteredConnection(): boolean {
  const conn = (navigator as unknown as { connection?: NetworkInfo }).connection
  if (!conn) return false
  return conn.saveData === true ||
    conn.effectiveType === '2g' ||
    conn.effectiveType === 'slow-2g'
}

// ─── Internal types ────────────────────────────────────────────────────────────

type DownloadEntry = {
  attachment: AttachmentDescriptor
  state: AttachmentDownloadState
  abortController: AbortController | null
  priority: 'manual' | 'auto'
  listeners: Set<(state: AttachmentDownloadState) => void>
}

type QueuedItem = {
  attachment: AttachmentDescriptor
  chatType: 'direct' | 'group'
}

// ─── DownloadManager ───────────────────────────────────────────────────────────

export class DownloadManager {
  private entries = new Map<string, DownloadEntry>()
  private queue: QueuedItem[] = []
  private activeCount = 0
  private maxConcurrent = 3
  private settings: AutoDownloadSettings
  private token: string | null
  private apiBaseUrl: string
  private globalListeners = new Set<() => void>()

  constructor(
    settings: AutoDownloadSettings,
    token: string | null,
    apiBaseUrl: string,
  ) {
    this.settings = settings
    this.token = token
    this.apiBaseUrl = apiBaseUrl
  }

  // ── Configuration updates ────────────────────────────────────────────────

  updateSettings(settings: AutoDownloadSettings) {
    this.settings = settings
  }

  updateToken(token: string | null) {
    this.token = token
  }

  updateApiBaseUrl(url: string) {
    this.apiBaseUrl = url
  }

  // ── Auto-download evaluation ─────────────────────────────────────────────

  shouldAutoDownload(
    attachment: AttachmentDescriptor,
    chatType: 'direct' | 'group',
  ): boolean {
    const chatConfig = chatType === 'direct'
      ? this.settings.private_chats
      : this.settings.group_chats
    const kind = inferMediaKindForDownload(attachment.contentType, attachment.fileName)
    const rule = chatConfig[kind]

    if (rule.max_size_bytes === 0) return false
    if (attachment.size > rule.max_size_bytes) return false
    if (!rule.on_cellular && isMeteredConnection()) return false

    return true
  }

  // ── State access ─────────────────────────────────────────────────────────

  getState(uploadId: string): AttachmentDownloadState {
    return this.entries.get(uploadId)?.state ?? { status: 'idle' }
  }

  getPlaybackUrl(uploadId: string): string | null {
    const state = this.entries.get(uploadId)?.state
    return state?.status === 'ready' ? state.playbackUrl : null
  }

  getAllPlaybackUrls(): Record<string, string> {
    const urls: Record<string, string> = {}
    for (const [id, entry] of this.entries) {
      if (entry.state.status === 'ready') {
        urls[id] = entry.state.playbackUrl
      }
    }
    return urls
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  onStateChange(uploadId: string, cb: (state: AttachmentDownloadState) => void): () => void {
    const entry = this.ensureEntry(uploadId)
    entry.listeners.add(cb)
    return () => entry.listeners.delete(cb)
  }

  onAnyStateChange(cb: () => void): () => void {
    this.globalListeners.add(cb)
    return () => this.globalListeners.delete(cb)
  }

  // ── Manual download ──────────────────────────────────────────────────────

  download(attachment: AttachmentDescriptor): void {
    const entry = this.ensureEntry(attachment.uploadId)

    // If already downloading or ready, skip
    if (entry.state.status === 'downloading' ||
        entry.state.status === 'decrypting' ||
        entry.state.status === 'ready') {
      return
    }

    entry.attachment = attachment
    entry.priority = 'manual'

    // Manual downloads bypass the queue
    this.startDownload(entry)
  }

  // ── Auto-download queueing ──────────────────────────────────────────────

  enqueueAutoDownload(attachment: AttachmentDescriptor, chatType: 'direct' | 'group'): void {
    const existing = this.entries.get(attachment.uploadId)
    if (existing && existing.state.status !== 'idle' && existing.state.status !== 'cancelled') {
      return // already queued, downloading, or ready
    }

    if (!this.shouldAutoDownload(attachment, chatType)) {
      return
    }

    const entry = this.ensureEntry(attachment.uploadId)
    entry.attachment = attachment
    entry.priority = 'auto'
    this.setState(entry, { status: 'auto_queued' })

    this.queue.push({ attachment, chatType })
    this.processQueue()
  }

  processAutoDownloads(
    attachments: { attachment: AttachmentDescriptor; chatType: 'direct' | 'group' }[],
  ): void {
    for (const { attachment, chatType } of attachments) {
      this.enqueueAutoDownload(attachment, chatType)
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────

  cancel(uploadId: string): void {
    const entry = this.entries.get(uploadId)
    if (!entry) return

    if (entry.state.status === 'downloading' || entry.state.status === 'decrypting') {
      entry.abortController?.abort()
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.setState(entry, { status: 'cancelled' })
      this.processQueue()
    } else if (entry.state.status === 'auto_queued') {
      this.queue = this.queue.filter((q) => q.attachment.uploadId !== uploadId)
      this.setState(entry, { status: 'cancelled' })
    }
  }

  // ── Mark expired ─────────────────────────────────────────────────────────

  markExpired(uploadId: string): void {
    const entry = this.ensureEntry(uploadId)
    this.setState(entry, { status: 'expired' })
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private ensureEntry(uploadId: string): DownloadEntry {
    let entry = this.entries.get(uploadId)
    if (!entry) {
      entry = {
        attachment: null as unknown as AttachmentDescriptor,
        state: { status: 'idle' },
        abortController: null,
        priority: 'auto',
        listeners: new Set(),
      }
      this.entries.set(uploadId, entry)
    }
    return entry
  }

  private setState(entry: DownloadEntry, state: AttachmentDownloadState) {
    entry.state = state
    for (const cb of entry.listeners) {
      try { cb(state) } catch { /* ignore */ }
    }
    for (const cb of this.globalListeners) {
      try { cb() } catch { /* ignore */ }
    }
  }

  private processQueue() {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!
      const entry = this.entries.get(item.attachment.uploadId)
      if (!entry || entry.state.status !== 'auto_queued') continue
      this.startDownload(entry)
    }
  }

  private async startDownload(entry: DownloadEntry) {
    if (!this.token) {
      this.setState(entry, { status: 'error', message: 'Not authenticated', retryable: true })
      return
    }

    const attachment = entry.attachment
    const abortController = new AbortController()
    entry.abortController = abortController
    this.activeCount++
    this.setState(entry, { status: 'downloading', progress: 0 })

    try {
      const apiRoot = buildApiRoot(this.apiBaseUrl)
      const url = `${apiRoot}/media/${attachment.uploadId}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: abortController.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        if (response.status === 410 || text.includes('expired') || text.includes('deleted')) {
          this.setState(entry, { status: 'expired' })
          this.activeCount = Math.max(0, this.activeCount - 1)
          this.processQueue()
          return
        }
        throw new Error(`Server returned ${response.status}`)
      }

      // Stream with progress
      const contentLength = parseInt(response.headers.get('Content-Length') ?? '0', 10)
      const reader = response.body?.getReader()

      let responseData: string
      if (reader && contentLength > 0) {
        const chunks: Uint8Array[] = []
        let loaded = 0

        while (true) {
          if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.length
          this.setState(entry, { status: 'downloading', progress: loaded / contentLength })
        }

        // Reassemble and parse JSON (the media endpoint returns JSON with base64 ciphertext)
        const fullBuffer = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset)
          offset += chunk.length
        }
        responseData = new TextDecoder().decode(fullBuffer)
      } else {
        responseData = await response.text()
      }

      if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError')

      const parsed = JSON.parse(responseData) as { upload: { ciphertext?: string } }
      if (!parsed.upload?.ciphertext) {
        throw new Error('Encrypted payload missing from server response')
      }

      // Decrypt
      this.setState(entry, { status: 'decrypting' })

      const blob = await decryptAttachmentFile(
        parsed.upload.ciphertext,
        attachment.contentKeyBase64,
        attachment.ivBase64,
        attachment.contentType,
      )
      const playbackUrl = URL.createObjectURL(blob)

      // Confirm delivery (fire-and-forget)
      if (this.token) {
        void confirmMediaDelivery(this.token, attachment.uploadId).catch(() => {})
      }

      this.setState(entry, { status: 'ready', playbackUrl })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Already handled by cancel()
        if (entry.state.status !== 'cancelled') {
          this.setState(entry, { status: 'cancelled' })
        }
      } else {
        this.setState(entry, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Download failed',
          retryable: true,
        })
      }
    } finally {
      entry.abortController = null
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.processQueue()
    }
  }
}

export { formatBytes }
