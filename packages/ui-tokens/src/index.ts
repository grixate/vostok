export type ColorTokens = {
  bg: string
  bgSecondary: string
  bgTertiary: string
  bgHover: string
  bgActive: string
  bgActiveHover: string
  bgInput: string
  accent: string
  accentSoft: string
  accentHover: string
  label: string
  labelSecondary: string
  labelTertiary: string
  textAccent: string
  textOnAccent: string
  fill: string
  separator: string
  separatorOpaque: string
  bubbleIncoming: string
  bubbleOutgoing: string
  bubbleSystem: string
  online: string
  danger: string
  success: string
  peerColors: string[]
}

export type TypographyTokens = {
  family: string
  heading: string
  headline: string
  title: string
  body: string
  bodyBold: string
  caption: string
  small: string
  micro: string
}

export type MotionTokens = {
  fast: string
  base: string
  slow: string
}

export const darkColors: ColorTokens = {
  bg: '#17212B',
  bgSecondary: '#0E1621',
  bgTertiary: '#1F2936',
  bgHover: '#202B36',
  bgActive: '#2B5278',
  bgActiveHover: '#3A6A99',
  bgInput: '#242F3D',
  accent: '#008BFF',
  accentSoft: 'rgba(0, 139, 255, 0.15)',
  accentHover: '#0077DB',
  label: '#F5F5F5',
  labelSecondary: '#708499',
  labelTertiary: '#546778',
  textAccent: '#6AB3F3',
  textOnAccent: '#FFFFFF',
  fill: 'rgba(255, 255, 255, 0.08)',
  separator: 'rgba(255, 255, 255, 0.08)',
  separatorOpaque: 'rgba(255, 255, 255, 0.04)',
  bubbleIncoming: '#182533',
  bubbleOutgoing: '#2B5278',
  bubbleSystem: 'rgba(0, 0, 0, 0.30)',
  online: '#4FAE4E',
  danger: '#E53935',
  success: '#4FAE4E',
  peerColors: ['#FF5C5C', '#4FAE4E', '#E6A817', '#009EE6', '#7B68EE', '#E667AF', '#20BFAB', '#EB7840'],
}

export const colors: ColorTokens = {
  bg: '#FFFFFF',
  bgSecondary: '#F0F2F5',
  bgTertiary: '#FFFFFF',
  bgHover: '#F0F2F5',
  bgActive: '#3390EC',
  bgActiveHover: '#2B80D1',
  bgInput: '#F0F2F5',
  accent: '#008BFF',
  accentSoft: 'rgba(0, 139, 255, 0.10)',
  accentHover: '#0077DB',
  label: '#000000',
  labelSecondary: '#707579',
  labelTertiary: '#A8ADB3',
  textAccent: '#3390EC',
  textOnAccent: '#FFFFFF',
  fill: 'rgba(0, 0, 0, 0.06)',
  separator: 'rgba(0, 0, 0, 0.08)',
  separatorOpaque: 'rgba(0, 0, 0, 0.04)',
  bubbleIncoming: '#FFFFFF',
  bubbleOutgoing: '#EFFDDE',
  bubbleSystem: 'rgba(255, 255, 255, 0.50)',
  online: '#4FAE4E',
  danger: '#E53935',
  success: '#4FAE4E',
  peerColors: ['#FF5C5C', '#4FAE4E', '#E6A817', '#009EE6', '#7B68EE', '#E667AF', '#20BFAB', '#EB7840'],
}

export const radius = {
  sm: "8px",
  md: "12px",
  lg: "12px",
  xl: "18px",
  pill: "999px"
} as const

export const shadows = {
  separator: "1px 0 0 0 rgba(255,255,255,0.06)",
  panel: "0 4px 24px rgba(0,0,0,0.30)",
  dropdown: "0 2px 8px rgba(0, 0, 0, 0.35)",
  popup: "0 2px 8px rgba(0, 0, 0, 0.35)",
  modal: "0 4px 24px rgba(0, 0, 0, 0.5)",
  tooltip: "0 1px 4px rgba(0, 0, 0, 0.3)"
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
  family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  heading: '510 20px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  headline: '510 16px/1.375 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  title: '510 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  body: '400 14px/1.4286 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  bodyBold: '510 14px/1.4286 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  caption: '400 13px/1.385 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  small: '400 12px/1.333 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  micro: '510 11px/1.27 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
}

export const motion: MotionTokens = {
  fast: "100ms",
  base: "150ms",
  slow: "200ms"
}

export const viewport = {
  chatRowHeight: 72,
  avatarList: 48,
  avatarHeader: 40,
  avatarCompact: 32,
  sidebarWidth: 380,
  settingsRowHeight: 52,
  detailRailWidth: 360,
  desktopBreakpoint: 960
} as const
