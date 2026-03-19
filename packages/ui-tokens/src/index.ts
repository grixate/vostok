export type ColorTokens = {
  bg: string
  bgSecondary: string
  bgTertiary: string
  bgHover: string
  bgActive: string
  bgActiveHover: string
  bgInput: string
  accent: string
  accentAlt: string
  accentAmber: string
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
  bg: '#090909',
  bgSecondary: '#111111',
  bgTertiary: '#1A1A1A',
  bgHover: '#1C1C1C',
  bgActive: '#1C1C1C',
  bgActiveHover: '#2A2A2A',
  bgInput: '#1A1A1A',
  accent: '#FF5500',
  accentAlt: '#FF9500',
  accentAmber: '#FFB347',
  accentSoft: 'rgba(255, 85, 0, 0.15)',
  accentHover: '#E64D00',
  label: '#FFFFFF',
  labelSecondary: '#888888',
  labelTertiary: '#555555',
  textAccent: '#FF5500',
  textOnAccent: '#FFFFFF',
  fill: 'rgba(255, 255, 255, 0.06)',
  separator: 'rgba(255, 255, 255, 0.035)',
  separatorOpaque: 'rgba(255, 255, 255, 0.02)',
  bubbleIncoming: '#1C1C1C',
  bubbleOutgoing: '#201B13',
  bubbleSystem: 'rgba(0, 0, 0, 0.30)',
  online: '#44CF6C',
  danger: '#E53935',
  success: '#34C759',
  peerColors: ['#FF5C5C', '#4FAE4E', '#E6A817', '#009EE6', '#7B68EE', '#E667AF', '#20BFAB', '#EB7840'],
}

export const colors: ColorTokens = {
  bg: '#EAEAEA',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#F5F5F5',
  bgHover: '#EFEFEF',
  bgActive: '#EFEFEF',
  bgActiveHover: '#E3E3E3',
  bgInput: '#F5F5F5',
  accent: '#FF5500',
  accentAlt: '#FF9500',
  accentAmber: '#FFB347',
  accentSoft: 'rgba(255, 85, 0, 0.10)',
  accentHover: '#E64D00',
  label: '#111111',
  labelSecondary: '#666666',
  labelTertiary: '#999999',
  textAccent: '#FF5500',
  textOnAccent: '#FFFFFF',
  fill: 'rgba(0, 0, 0, 0.04)',
  separator: 'rgba(0, 0, 0, 0.08)',
  separatorOpaque: 'rgba(0, 0, 0, 0.04)',
  bubbleIncoming: '#EFEFEF',
  bubbleOutgoing: '#FFE5CC',
  bubbleSystem: 'rgba(255, 255, 255, 0.50)',
  online: '#44CF6C',
  danger: '#D32F2F',
  success: '#2DA44E',
  peerColors: ['#FF5C5C', '#4FAE4E', '#E6A817', '#009EE6', '#7B68EE', '#E667AF', '#20BFAB', '#EB7840'],
}

export const radius = {
  sm: "8px",
  md: "14px",
  lg: "20px",
  xl: "20px",
  pill: "100px"
} as const

export const shadows = {
  separator: "1px 0 0 0 rgba(255,255,255,0.035)",
  panel: "0 4px 24px rgba(0,0,0,0.40)",
  dropdown: "0 2px 8px rgba(0, 0, 0, 0.45)",
  popup: "0 2px 8px rgba(0, 0, 0, 0.45)",
  modal: "0 4px 24px rgba(0, 0, 0, 0.6)",
  tooltip: "0 1px 4px rgba(0, 0, 0, 0.4)"
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
  family: "'Inter', sans-serif",
  heading: "700 22px/1.2 'Inter', sans-serif",
  headline: "600 16px/1.375 'Inter', sans-serif",
  title: "510 15px/1.2 'Inter', sans-serif",
  body: "400 14px/1.4286 'Inter', sans-serif",
  bodyBold: "510 14px/1.4286 'Inter', sans-serif",
  caption: "400 13px/1.385 'Inter', sans-serif",
  small: "400 12px/1.333 'Inter', sans-serif",
  micro: "510 11px/1.27 'Inter', sans-serif",
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
  avatarMessage: 34,
  avatarCompact: 32,
  sidebarWidth: 360,
  settingsRowHeight: 52,
  detailRailWidth: 360,
  desktopBreakpoint: 960
} as const
