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
  heading: string
  title: string
  body: string
  caption: string
  micro: string
}

export type MotionTokens = {
  fast: string
  base: string
  slow: string
}

export const darkColors: ColorTokens = {
  bg: '#1C1C1E',
  bgSecondary: '#2C2C2E',
  bgTertiary: '#3A3A3C',
  accent: '#0A84FF',
  accentSoft: 'rgba(10, 132, 255, 0.15)',
  label: '#FFFFFF',
  labelSecondary: 'rgba(235, 235, 245, 0.60)',
  labelTertiary: 'rgba(235, 235, 245, 0.30)',
  fill: 'rgba(120, 120, 128, 0.24)',
  separator: '#38383A',
  separatorOpaque: '#48484A',
  bubbleIncoming: '#2C2C2E',
  bubbleOutgoing: '#1A472A',
  bubbleSystem: 'rgba(0, 0, 0, 0.30)',
  online: '#30D158',
  danger: '#FF453A',
  success: '#30D158',
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
  sm: "8px",
  md: "12px",
  lg: "17px",
  xl: "20px",
  pill: "999px"
} as const

export const shadows = {
  separator: "1px 0 0 0 rgba(0,0,0,0.06)",
  panel: "0 4px 24px rgba(0,0,0,0.08)",
  dropdown: "0 4px 24px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)"
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
  heading: "700 20px/1.2 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  title: "510 15px/1.2 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  body: "400 14px/1.4 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  caption: "400 12px/1.3 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif",
  micro: "510 11px/1.15 -apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif"
}

export const motion: MotionTokens = {
  fast: "120ms",
  base: "180ms",
  slow: "280ms"
}

export const viewport = {
  chatRowHeight: 78,
  avatarList: 62,
  avatarHeader: 48,
  avatarCompact: 40,
  sidebarWidth: 380,
  settingsRowHeight: 52,
  detailRailWidth: 360,
  desktopBreakpoint: 960
} as const
