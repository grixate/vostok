/**
 * useDesktopWindow — manages all Tauri desktop window state.
 * Fully isolated: no deps on auth, chat, or call state.
 */

import { useState, useEffect } from 'react'
import {
  applyDesktopWindowGeometry,
  closeDesktopWindow,
  fetchDesktopWindowGeometry,
  fetchDesktopRuntimeInfo,
  fetchDesktopWindowState,
  isDesktopShell,
  minimizeDesktopWindow,
  resetDesktopWindowGeometry,
  setDesktopWindowAlwaysOnTop as applyDesktopWindowAlwaysOnTop,
  subscribeDesktopWindowGeometry,
  subscribeDesktopWindowState,
  toggleDesktopWindowAlwaysOnTop,
  toggleDesktopWindowFullscreen,
  toggleDesktopWindowMaximize,
  type DesktopWindowGeometry,
  type DesktopRuntimeInfo,
} from '../../lib/desktop-shell'
import type { Banner } from '../types/chat'

// ── Constants ─────────────────────────────────────────────────────────────────

const DETAIL_RAIL_STORAGE_KEY = 'vostok.layout.detail_rail_visible'
export const DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY = 'vostok.desktop.always_on_top'
export const DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY = 'vostok.desktop.window_geometry'
export const DESKTOP_DETAIL_RAIL_BREAKPOINT = 1200

// ── localStorage helpers ──────────────────────────────────────────────────────

export function readDetailRailPreference(): boolean {
  if (typeof window === 'undefined') return true

  const raw = window.localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)

  if (raw === 'true') return true
  if (raw === 'false') return false

  return window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
}

export function readDesktopAlwaysOnTopPreference(): boolean | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY)

  if (raw === 'true') return true
  if (raw === 'false') return false

  return null
}

export function readDesktopWindowGeometry(): DesktopWindowGeometry | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)

  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<DesktopWindowGeometry>

    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height }
    }
  } catch {
    // Fall through to remove invalid state.
  }

  window.localStorage.removeItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY)
  return null
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesktopWindowState {
  isDesktopWide: boolean
  desktopShell: boolean
  desktopRuntime: DesktopRuntimeInfo | null
  desktopWindowMaximized: boolean | null
  desktopWindowFocused: boolean | null
  desktopWindowAlwaysOnTop: boolean | null
  desktopWindowFullscreen: boolean | null
  desktopWindowGeometry: DesktopWindowGeometry | null
  detailRailPreferred: boolean
  setDetailRailPreferred: React.Dispatch<React.SetStateAction<boolean>>
  toggleDetailRail: () => void
  handleRefreshDesktopRuntime: () => Promise<void>
  handleToggleDesktopWindowMaximize: () => Promise<void>
  handleMinimizeDesktopHostWindow: () => Promise<void>
  handleCloseDesktopHostWindow: () => Promise<void>
  handleToggleDesktopAlwaysOnTop: () => Promise<void>
  handleToggleDesktopFullscreen: () => Promise<void>
  handleCopyDesktopDiagnostics: (extraContext?: DesktopDiagnosticsContext) => Promise<void>
  handleResetDesktopHostWindowFrame: () => Promise<void>
}

export interface DesktopDiagnosticsContext {
  desktopWindowTitle?: string
  detailRailVisible?: boolean
  activeChatId?: string | null
  activeChatTitle?: string | null
  activeCallId?: string | null
  activeCallMode?: string | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDesktopWindow(params: {
  setLoading: (b: boolean) => void
  setBanner: (b: Banner | null) => void
}): DesktopWindowState {
  const { setLoading, setBanner } = params

  const [isDesktopWide, setIsDesktopWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT
  )
  const [desktopRuntime, setDesktopRuntime] = useState<DesktopRuntimeInfo | null>(null)
  const [desktopWindowMaximized, setDesktopWindowMaximized] = useState<boolean | null>(null)
  const [desktopWindowFocused, setDesktopWindowFocused] = useState<boolean | null>(null)
  const [desktopWindowAlwaysOnTop, setDesktopWindowAlwaysOnTop] = useState<boolean | null>(null)
  const [desktopWindowFullscreen, setDesktopWindowFullscreen] = useState<boolean | null>(null)
  const [desktopWindowGeometry, setDesktopWindowGeometry] =
    useState<DesktopWindowGeometry | null>(null)
  const [detailRailPreferred, setDetailRailPreferred] = useState(() =>
    readDetailRailPreference()
  )

  // ── Viewport width tracker ────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncViewportMode = () => {
      setIsDesktopWide(window.innerWidth >= DESKTOP_DETAIL_RAIL_BREAKPOINT)
    }

    syncViewportMode()
    window.addEventListener('resize', syncViewportMode)

    return () => {
      window.removeEventListener('resize', syncViewportMode)
    }
  }, [])

  // ── Persist detail-rail preference ───────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, String(detailRailPreferred))
  }, [detailRailPreferred])

  // ── Persist always-on-top preference ─────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || desktopWindowAlwaysOnTop === null) return
    window.localStorage.setItem(
      DESKTOP_ALWAYS_ON_TOP_STORAGE_KEY,
      String(desktopWindowAlwaysOnTop)
    )
  }, [desktopWindowAlwaysOnTop])

  // ── Desktop runtime + window state bootstrap ──────────────────────────────

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

        const [
          runtime,
          initialWindowState,
          geometry,
          unlistenState,
          unlistenGeometry,
        ] = await Promise.all([
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
          }),
        ])

        const windowState =
          savedAlwaysOnTop === null || savedAlwaysOnTop === initialWindowState.alwaysOnTop
            ? initialWindowState
            : {
                ...initialWindowState,
                alwaysOnTop: await applyDesktopWindowAlwaysOnTop(savedAlwaysOnTop),
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleRefreshDesktopRuntime() {
    if (!isDesktopShell()) {
      setBanner({ tone: 'info', message: 'Desktop runtime details are only available inside the Tauri shell.' })
      return
    }

    setLoading(true)

    try {
      const [runtime, windowState] = await Promise.all([
        fetchDesktopRuntimeInfo(),
        fetchDesktopWindowState(),
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
        message: nextState ? 'Desktop window maximized.' : 'Desktop window restored.',
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
        message: nextState ? 'Desktop window pinned on top.' : 'Desktop window returned to normal stacking.',
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
        message: nextState ? 'Desktop window entered fullscreen.' : 'Desktop window exited fullscreen.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle fullscreen mode.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyDesktopDiagnostics(extraContext: DesktopDiagnosticsContext = {}) {
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
          fullscreen: desktopWindowFullscreen,
        },
        windowGeometry: desktopWindowGeometry,
        nativeTitle: extraContext.desktopWindowTitle,
        layout: {
          detailRailPreferred,
          detailRailVisible: extraContext.detailRailVisible,
          isDesktopWide,
        },
        activeContext: {
          activeChatId: extraContext.activeChatId ?? null,
          activeChatTitle: extraContext.activeChatTitle ?? null,
          activeCallId: extraContext.activeCallId ?? null,
          activeCallMode: extraContext.activeCallMode ?? null,
        },
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
      window.localStorage.setItem(DESKTOP_WINDOW_GEOMETRY_STORAGE_KEY, JSON.stringify(geometry))
      setBanner({
        tone: 'success',
        message: `Desktop window frame reset to ${geometry.width}×${geometry.height} and recentered.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset the desktop window frame.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    isDesktopWide,
    desktopShell: isDesktopShell(),
    desktopRuntime,
    desktopWindowMaximized,
    desktopWindowFocused,
    desktopWindowAlwaysOnTop,
    desktopWindowFullscreen,
    desktopWindowGeometry,
    detailRailPreferred,
    setDetailRailPreferred,
    toggleDetailRail: () => setDetailRailPreferred((current) => !current),
    handleRefreshDesktopRuntime,
    handleToggleDesktopWindowMaximize,
    handleMinimizeDesktopHostWindow,
    handleCloseDesktopHostWindow,
    handleToggleDesktopAlwaysOnTop,
    handleToggleDesktopFullscreen,
    handleCopyDesktopDiagnostics,
    handleResetDesktopHostWindowFrame,
  }
}
