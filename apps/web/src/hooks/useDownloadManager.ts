import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { DownloadManager, DEFAULT_AUTO_DOWNLOAD } from '../lib/download-manager.ts'
import type { AttachmentDescriptor, AttachmentDownloadState, AutoDownloadSettings } from '../types.ts'

export function useDownloadManager(
  settings: AutoDownloadSettings | undefined,
  sessionToken: string | null,
  apiBaseUrl: string,
) {
  const resolvedSettings = settings ?? DEFAULT_AUTO_DOWNLOAD

  const managerRef = useRef<DownloadManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = new DownloadManager(resolvedSettings, sessionToken, apiBaseUrl)
  }
  const manager = managerRef.current

  // Keep manager in sync with changing props
  useEffect(() => { manager.updateSettings(resolvedSettings) }, [manager, resolvedSettings])
  useEffect(() => { manager.updateToken(sessionToken) }, [manager, sessionToken])
  useEffect(() => { manager.updateApiBaseUrl(apiBaseUrl) }, [manager, apiBaseUrl])

  // Subscribe to state changes for re-renders
  const subscribe = useCallback(
    (onStoreChange: () => void) => manager.onAnyStateChange(onStoreChange),
    [manager],
  )

  // Snapshot: a version counter incremented on any state change
  const versionRef = useRef(0)
  useEffect(() => {
    return manager.onAnyStateChange(() => { versionRef.current++ })
  }, [manager])

  const getSnapshot = useCallback(() => versionRef.current, [])

  // This triggers re-renders when any download state changes
  useSyncExternalStore(subscribe, getSnapshot)

  const getState = useCallback(
    (uploadId: string): AttachmentDownloadState => manager.getState(uploadId),
    [manager],
  )

  const download = useCallback(
    (attachment: AttachmentDescriptor) => manager.download(attachment),
    [manager],
  )

  const cancel = useCallback(
    (uploadId: string) => manager.cancel(uploadId),
    [manager],
  )

  const processAutoDownloads = useCallback(
    (attachments: { attachment: AttachmentDescriptor; chatType: 'direct' | 'group' }[]) =>
      manager.processAutoDownloads(attachments),
    [manager],
  )

  const markExpired = useCallback(
    (uploadId: string) => manager.markExpired(uploadId),
    [manager],
  )

  const playbackUrls = useMemo(
    () => manager.getAllPlaybackUrls(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manager, versionRef.current],
  )

  return {
    getState,
    download,
    cancel,
    processAutoDownloads,
    markExpired,
    playbackUrls,
    manager,
  }
}
