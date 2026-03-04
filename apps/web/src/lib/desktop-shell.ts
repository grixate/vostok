export type DesktopRuntimeInfo = {
  appName: string
  appVersion: string
  platform: string
  arch: string
  debug: boolean
}

export type DesktopWindowState = {
  maximized: boolean
  focused: boolean
  alwaysOnTop: boolean
}

export type DesktopWindowGeometry = {
  x: number
  y: number
  width: number
  height: number
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'
}

export async function fetchDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo> {
  const { invoke } = await import('@tauri-apps/api/core')

  return invoke<DesktopRuntimeInfo>('desktop_runtime_info')
}

export async function toggleDesktopWindowMaximize(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')

  return invoke<boolean>('desktop_toggle_maximize')
}

export async function fetchDesktopWindowMaximized(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')

  return invoke<boolean>('desktop_window_maximized')
}

export async function minimizeDesktopWindow(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')

  await invoke('desktop_minimize')
}

export async function closeDesktopWindow(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')

  await invoke('desktop_close_window')
}

export async function setDesktopWindowTitle(title: string): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')

  await getCurrentWindow().setTitle(title)
}

export async function fetchDesktopWindowState(): Promise<DesktopWindowState> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  const [maximized, focused, alwaysOnTop] = await Promise.all([
    appWindow.isMaximized(),
    appWindow.isFocused(),
    appWindow.isAlwaysOnTop()
  ])

  return {
    maximized,
    focused,
    alwaysOnTop
  }
}

export async function toggleDesktopWindowAlwaysOnTop(): Promise<boolean> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  const nextValue = !(await appWindow.isAlwaysOnTop())

  await appWindow.setAlwaysOnTop(nextValue)
  return nextValue
}

export async function fetchDesktopWindowGeometry(): Promise<DesktopWindowGeometry> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()])

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height
  }
}

export async function applyDesktopWindowGeometry(geometry: DesktopWindowGeometry): Promise<void> {
  const [{ getCurrentWindow }, { PhysicalPosition, PhysicalSize }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/dpi')
  ])
  const appWindow = getCurrentWindow()

  await appWindow.setPosition(new PhysicalPosition(geometry.x, geometry.y))
  await appWindow.setSize(new PhysicalSize(geometry.width, geometry.height))
}

export async function subscribeDesktopWindowState(
  onChange: (state: DesktopWindowState) => void
): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  let disposed = false

  const emitState = async () => {
    if (disposed) {
      return
    }

    try {
      const nextState = await fetchDesktopWindowState()

      if (!disposed) {
        onChange(nextState)
      }
    } catch {
      // Ignore transient desktop host query failures.
    }
  }

  const unlisten = await Promise.all([
    appWindow.onResized(() => {
      void emitState()
    }),
    appWindow.onMoved(() => {
      void emitState()
    }),
    appWindow.onFocusChanged(() => {
      void emitState()
    })
  ])

  await emitState()

  return () => {
    disposed = true

    for (const stop of unlisten) {
      stop()
    }
  }
}

export async function subscribeDesktopWindowGeometry(
  onChange: (geometry: DesktopWindowGeometry) => void
): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  let disposed = false

  const emitGeometry = async () => {
    if (disposed) {
      return
    }

    try {
      const geometry = await fetchDesktopWindowGeometry()

      if (!disposed) {
        onChange(geometry)
      }
    } catch {
      // Ignore transient desktop geometry query failures.
    }
  }

  const unlisten = await Promise.all([
    appWindow.onResized(() => {
      void emitGeometry()
    }),
    appWindow.onMoved(() => {
      void emitGeometry()
    })
  ])

  await emitGeometry()

  return () => {
    disposed = true

    for (const stop of unlisten) {
      stop()
    }
  }
}
