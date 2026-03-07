import { useEffect, useState } from 'react'
import {
  applyDesktopWindowGeometry,
  closeDesktopWindow,
  fetchDesktopWindowGeometry,
  fetchDesktopRuntimeInfo,
  fetchDesktopWindowState,
  type DesktopWindowGeometry,
  isDesktopShell,
  minimizeDesktopWindow,
  resetDesktopWindowGeometry,
  setDesktopWindowAlwaysOnTop as applyDesktopWindowAlwaysOnTop,
  subscribeDesktopWindowGeometry,
  setDesktopWindowTitle,
  subscribeDesktopWindowState,
  toggleDesktopWindowAlwaysOnTop,
  toggleDesktopWindowFullscreen,
  toggleDesktopWindowMaximize,
  type DesktopRuntimeInfo
} from '../lib/desktop-shell'
import {
  DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY,
  DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY
} from '../constants'
import { readDesktopWindowGeometry } from '../utils/storage'
import { readDesktopAlwaysOnTopPreference } from '../utils/desktop-helpers'
import { buildDesktopWindowTitle } from '../utils/call-helpers'
import { useAppContext } from '../contexts/AppContext'

export type UseDesktopParams = {
  activeChatTitle: string | null
  activeCallMode: 'group' | 'voice' | 'video' | null
  detailRailPreferred: boolean
  detailRailVisible: boolean
  isDesktopWide: boolean
  activeChatId: string | null
  activeCallId: string | null
}

export function useDesktop(params: UseDesktopParams) {
  const { setBanner, setLoading } = useAppContext()
  const {
    activeChatTitle,
    activeCallMode,
    detailRailPreferred,
    detailRailVisible,
    isDesktopWide,
    activeChatId,
    activeCallId
  } = params

  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null)
  const [desktopWindowMaximized, setDesktopWindowMaximized] = useState<boolean | null>(null)
  const [desktopWindowFocused, setDesktopWindowFocused] = useState<boolean | null>(null)
  const [desktopWindowAlwaysOnTop, setDesktopWindowAlwaysOnTop] = useState<boolean | null>(null)
  const [desktopWindowFullscreen, setDesktopWindowFullscreen] = useState<boolean | null>(null)
  const [desktopWindowGeometry, setDesktopWindowGeometry] = useState<DesktopWindowGeometry | null>(null)

  const desktopShell = isDesktopShell()
  const desktopWindowTitle = buildDesktopWindowTitle(activeChatTitle, activeCallMode)

  // Always-on-top persistence
  useEffect(() => {
    if (typeof window === 'undefined' || desktopWindowAlwaysOnTop === null) {
      return
    }

    window.localStorage.setItem(
      DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY,
      String(desktopWindowAlwaysOnTop)
    )
  }, [desktopWindowAlwaysOnTop])

  // Runtime bootstrap, window state subscription, geometry persistence
  useEffect(() => {
    if (!isDesktopShell()) {
      setDesktopRuntime(null)
      setDesktopWindowMaximized(null)
      setDesktopWindowFocused(null)
      setDesktopWindowAlwaysOnTop(null)
      setDesktopWindowFullscreen(null)
      setDesktopWindowGeometry(null)
      return
    }

    let cancelled = false
    let stopStateSync: (() => void) | null = null
    let stopGeometrySync: (() => void) | null = null

    async function loadDesktopRuntime() {
      try {
        const savedGeometry = readDesktopWindowGeometry()
        const savedAlwaysOnTop = readDesktopAlwaysOnTopPreference()

        if (savedGeometry) {
          await applyDesktopWindowGeometry(savedGeometry)
        }

        const [runtime, initialWindowState, geometry, unlistenState, unlistenGeometry] = await Promise.all([
          fetchDesktopRuntimeInfo(),
          fetchDesktopWindowState(),
          fetchDesktopWindowGeometry(),
          subscribeDesktopWindowState((nextState) => {
            if (!cancelled) {
              setDesktopWindowMaximized(nextState.maximized)
              setDesktopWindowFocused(nextState.focused)
              setDesktopWindowAlwaysOnTop(nextState.alwaysOnTop)
              setDesktopWindowFullscreen(nextState.fullscreen)
            }
          }),
          subscribeDesktopWindowGeometry((nextGeometry) => {
            if (!cancelled) {
              setDesktopWindowGeometry(nextGeometry)
              window.localStorage.setItem(
                DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
                JSON.stringify(nextGeometry)
              )
            }
          })
        ])

        const windowState =
          savedAlwaysOnTop === null || savedAlwaysOnTop === initialWindowState.alwaysOnTop
            ? initialWindowState
            : {
                ...initialWindowState,
                alwaysOnTop: await applyDesktopWindowAlwaysOnTop(savedAlwaysOnTop)
              }

        if (!cancelled) {
          setDesktopRuntime(runtime)
          setDesktopWindowMaximized(windowState.maximized)
          setDesktopWindowFocused(windowState.focused)
          setDesktopWindowAlwaysOnTop(windowState.alwaysOnTop)
          setDesktopWindowFullscreen(windowState.fullscreen)
          setDesktopWindowGeometry(geometry)
          window.localStorage.setItem(
            DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
            JSON.stringify(geometry)
          )
          stopStateSync = unlistenState
          stopGeometrySync = unlistenGeometry
        } else {
          unlistenState()
          unlistenGeometry()
        }
      } catch {
        if (!cancelled) {
          setDesktopRuntime(null)
          setDesktopWindowMaximized(null)
          setDesktopWindowFocused(null)
          setDesktopWindowAlwaysOnTop(null)
          setDesktopWindowFullscreen(null)
          setDesktopWindowGeometry(null)
        }
      }
    }

    void loadDesktopRuntime()

    return () => {
      cancelled = true
      stopStateSync?.()
      stopGeometrySync?.()
    }
  }, [])

  // Desktop title sync
  useEffect(() => {
    if (!desktopShell) {
      return
    }

    let cancelled = false

    async function syncDesktopTitle() {
      try {
        await setDesktopWindowTitle(desktopWindowTitle)
      } catch {
        if (!cancelled) {
          // Ignore transient desktop title sync failures.
        }
      }
    }

    void syncDesktopTitle()

    return () => {
      cancelled = true
    }
  }, [desktopShell, desktopWindowTitle])

  async function handleRefreshDesktopRuntime() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Desktop runtime details are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const [runtime, windowState] = await Promise.all([
        fetchDesktopRuntimeInfo(),
        fetchDesktopWindowState()
      ])
      setDesktopRuntime(runtime)
      setDesktopWindowMaximized(windowState.maximized)
      setDesktopWindowFocused(windowState.focused)
      setDesktopWindowAlwaysOnTop(windowState.alwaysOnTop)
      setDesktopWindowFullscreen(windowState.fullscreen)
      setBanner({ tone: 'success', message: 'Desktop runtime details refreshed.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh desktop runtime info.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopWindowMaximize() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowMaximize()
      setDesktopWindowMaximized(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window maximized.' : 'Desktop window restored.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle the desktop window state.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleMinimizeDesktopHostWindow() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      await minimizeDesktopWindow()
      setBanner({ tone: 'success', message: 'Desktop window minimized.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to minimize the desktop window.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCloseDesktopHostWindow() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      await closeDesktopWindow()
      setBanner({ tone: 'success', message: 'Desktop window close requested.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close the desktop window.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopAlwaysOnTop() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowAlwaysOnTop()
      setDesktopWindowAlwaysOnTop(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window pinned on top.' : 'Desktop window returned to normal stacking.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update always-on-top state.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDesktopFullscreen() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const nextState = await toggleDesktopWindowFullscreen()
      setDesktopWindowFullscreen(nextState)
      setBanner({
        tone: 'success',
        message: nextState ? 'Desktop window entered fullscreen.' : 'Desktop window exited fullscreen.'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle fullscreen mode.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyDesktopDiagnostics() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setBanner({ tone: 'error', message: 'Clipboard access is not available in this environment.' })
      return
    }

    setLoading(true)

    try {
      const diagnostics = {
        capturedAt: new Date().toISOString(),
        desktopShell: isDesktopShell(),
        desktopRuntime,
        windowState: {
          maximized: desktopWindowMaximized,
          focused: desktopWindowFocused,
          alwaysOnTop: desktopWindowAlwaysOnTop,
          fullscreen: desktopWindowFullscreen
        },
        windowGeometry: desktopWindowGeometry,
        nativeTitle: desktopWindowTitle,
        layout: {
          detailRailPreferred,
          detailRailVisible,
          isDesktopWide
        },
        activeContext: {
          activeChatId,
          activeChatTitle,
          activeCallId,
          activeCallMode
        }
      }

      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setBanner({ tone: 'success', message: 'Desktop diagnostics copied to the clipboard.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy desktop diagnostics.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleResetDesktopHostWindowFrame() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Window controls are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const geometry = await resetDesktopWindowGeometry()
      setDesktopWindowGeometry(geometry)
      setDesktopWindowMaximized(false)
      setDesktopWindowFullscreen(false)
      window.localStorage.setItem(
        DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY,
        JSON.stringify(geometry)
      )
      setBanner({
        tone: 'success',
        message: `Desktop window frame reset to ${geometry.width}x${geometry.height} and recentered.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset the desktop window frame.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    desktopRuntime,
    desktopWindowMaximized,
    desktopWindowFocused,
    desktopWindowAlwaysOnTop,
    desktopWindowFullscreen,
    desktopWindowGeometry,
    desktopShell,
    desktopWindowTitle,
    handleRefreshDesktopRuntime,
    handleToggleDesktopWindowMaximize,
    handleMinimizeDesktopHostWindow,
    handleCloseDesktopHostWindow,
    handleToggleDesktopAlwaysOnTop,
    handleToggleDesktopFullscreen,
    handleCopyDesktopDiagnostics,
    handleResetDesktopHostWindowFrame
  }
}
