export type ColorTokens = {
  page: string
  panel: string
  panelMuted: string
  glass: string
  glassBorder: string
  accent: string
  accentSoft: string
  textStrong: string
  textMuted: string
  textInverse: string
  bubbleIncoming: string
  bubbleOutgoing: string
  bubbleSystem: string
  danger: string
  success: string
}

export type TypographyTokens = {
  familySans: string
  familyMono: string
  title: string
  body: string
  caption: string
}

export type MotionTokens = {
  fast: string
  base: string
  slow: string
}

export const colors: ColorTokens = {
  page: "#d5e1c2",
  panel: "rgba(255, 255, 255, 0.78)",
  panelMuted: "rgba(255, 255, 255, 0.56)",
  glass: "rgba(255, 255, 255, 0.66)",
  glassBorder: "rgba(255, 255, 255, 0.46)",
  accent: "#1d6df2",
  accentSoft: "rgba(29, 109, 242, 0.12)",
  textStrong: "#182214",
  textMuted: "#4e5d49",
  textInverse: "#f8fbf3",
  bubbleIncoming: "rgba(255, 255, 255, 0.75)",
  bubbleOutgoing: "#2f7cf7",
  bubbleSystem: "rgba(34, 48, 29, 0.08)",
  danger: "#b84b4b",
  success: "#2b8a57"
}

export const radius = {
  shell: "32px",
  panel: "24px",
  pill: "999px",
  bubble: "22px"
} as const

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  xxl: "2rem"
} as const

export const typography: TypographyTokens = {
  familySans: "\"SF Pro Display\", \"SF Pro Text\", ui-sans-serif, system-ui, sans-serif",
  familyMono: "\"SF Mono\", ui-monospace, monospace",
  title: "600 0.95rem/1.2 \"SF Pro Display\", \"SF Pro Text\", ui-sans-serif, system-ui, sans-serif",
  body: "400 1rem/1.4 \"SF Pro Text\", ui-sans-serif, system-ui, sans-serif",
  caption: "500 0.78rem/1.2 \"SF Pro Text\", ui-sans-serif, system-ui, sans-serif"
}

export const motion: MotionTokens = {
  fast: "120ms",
  base: "180ms",
  slow: "280ms"
}

export const viewport = {
  phoneFrame: { width: 402, height: 874 },
  desktopBreakpoint: 960
} as const

