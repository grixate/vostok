export type ColorTokens = {
  bg: string
  bgSecondary: string
  bgTertiary: string
  accent: string
  accentSoft: string
  label: string
  labelSecondary: string
  labelTertiary: string
  fill: string
  separator: string
  separatorOpaque: string
  bubbleIncoming: string
  bubbleOutgoing: string
  bubbleSystem: string
  online: string
  danger: string
  success: string
}

export type TypographyTokens = {
  family: string
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
  bg: "#FFFFFF",
  bgSecondary: "#F2F2F7",
  bgTertiary: "#F9F9F9",
  accent: "#008BFF",
  accentSoft: "rgba(0, 139, 255, 0.10)",
  label: "#000000",
  labelSecondary: "rgba(60, 60, 67, 0.60)",
  labelTertiary: "rgba(60, 60, 67, 0.30)",
  fill: "rgba(120, 120, 128, 0.12)",
  separator: "#E6E6E6",
  separatorOpaque: "#C6C6C8",
  bubbleIncoming: "#FFFFFF",
  bubbleOutgoing: "#c8ffa3",
  bubbleSystem: "rgba(255, 255, 255, 0.50)",
  online: "#34C759",
  danger: "#FF3B30",
  success: "#34C759"
}

export const radius = {
  sm: "10px",
  md: "14px",
  lg: "18px",
  xl: "20px",
  pill: "999px"
} as const

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px"
} as const

export const typography: TypographyTokens = {
  family: "-apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  title: "600 17px/1.2 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  body: "400 15px/1.4 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  caption: "400 13px/1.2 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
}

export const motion: MotionTokens = {
  fast: "120ms",
  base: "180ms",
  slow: "280ms"
}

export const viewport = {
  chatRowHeight: 78,
  avatarList: 52,
  avatarHeader: 36,
  sidebarWidth: 320,
  desktopBreakpoint: 960
} as const
