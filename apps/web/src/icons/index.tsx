/**
 * Centralized icon system for Vostok.
 * All icons use 20x20 viewBox, 1.5px stroke weight, currentColor for stroke.
 */

type IconProps = React.SVGProps<SVGSVGElement>

const defaults: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  'aria-hidden': true,
}

function icon(paths: React.ReactNode, overrides?: Partial<typeof defaults>) {
  const merged = { ...defaults, ...overrides }
  return function Icon(props: IconProps) {
    return <svg {...merged} {...props}>{paths}</svg>
  }
}

// ---- Navigation ----

export const SearchIcon = icon(
  <>
    <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const ComposeIcon = icon(
  <>
    {/* Page outline — open top-right where the pencil overlaps */}
    <path d="M12 3H5C3.9 3 3 3.9 3 5V15C3 16.1 3.9 17 5 17H15C16.1 17 17 16.1 17 15V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {/* Pencil writing on the page */}
    <path d="M14 1.5L18 5.5L9 14.5H5.5V11L14 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </>
)

export const BackIcon = icon(
  <path d="M12.5 4L6 10L12.5 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const CloseIcon = icon(
  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

export const HamburgerIcon = icon(
  <path d="M3 5H17M3 10H17M3 15H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

// ---- Conversation ----

export const PhoneIcon = icon(
  <path d="M17 14.2V16.5C17 17 16.6 17.4 16.1 17.5C15.7 17.5 15.3 17.5 14.9 17.5C8.3 17.5 3 12.2 3 5.6C3 5.2 3 4.8 3.1 4.4C3.1 3.9 3.5 3.5 4 3.5H6.3C6.7 3.5 7.1 3.8 7.2 4.2C7.3 4.8 7.5 5.3 7.7 5.8C7.8 6.1 7.7 6.4 7.5 6.6L6.5 7.6C7.5 9.4 9.1 11 10.9 12L11.9 11C12.1 10.8 12.4 10.7 12.7 10.8C13.2 11 13.7 11.2 14.3 11.3C14.7 11.4 15 11.8 15 12.2V14.2H17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const MoreVertIcon = icon(
  <>
    <circle cx="10" cy="5" r="1.5" fill="currentColor" />
    <circle cx="10" cy="10" r="1.5" fill="currentColor" />
    <circle cx="10" cy="15" r="1.5" fill="currentColor" />
  </>
)

// ---- Context Menu / Message Actions ----

export const ReplyIcon = icon(
  <>
    <path d="M7 4.5L2.5 9L7 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 9H12C14.5 9 16.5 11 16.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const EditIcon = icon(
  <>
    <path d="M12 3L17 8L7 18H2V13L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M10 5L15 10" stroke="currentColor" strokeWidth="1.5" />
  </>
)

export const PinIcon = icon(
  <>
    <path d="M11.5 2.5L14.5 5.5L10.5 9.5V13L8 10.5L3.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M6.5 6.5L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const CopyIcon = icon(
  <>
    <rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 6V4.5C14 3.4 13.1 2.5 12 2.5H5C3.9 2.5 3 3.4 3 4.5V12C3 13.1 3.9 14 5 14H6" stroke="currentColor" strokeWidth="1.5" />
  </>
)

export const DeleteIcon = icon(
  <path d="M4 5H16M7 5V3.5C7 2.9 7.4 2.5 8 2.5H12C12.6 2.5 13 2.9 13 3.5V5M5.5 5V16C5.5 16.6 5.9 17 6.5 17H13.5C14.1 17 14.5 16.6 14.5 16V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

// ---- Composer / Attach ----

export const AttachIcon = icon(
  <path d="M17 9.5L10 16.5C8 18.5 5 18.5 3 16.5C1 14.5 1 11.5 3 9.5L10 2.5C11.5 1 14 1 15.5 2.5C17 4 17 6.5 15.5 8L8.5 15C7.5 16 6 16 5 15C4 14 4 12.5 5 11.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

export const PhotoIcon = icon(
  <>
    <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7" cy="7" r="1.75" fill="currentColor" />
    <path d="M2.5 14L6.5 9.5L9.5 12.5L12 10L17.5 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
)

export const FileIcon = icon(
  <>
    <path d="M11 2H5.5C4.7 2 4 2.7 4 3.5V16.5C4 17.3 4.7 18 5.5 18H14.5C15.3 18 16 17.3 16 16.5V7L11 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M11 2V7H16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </>
)

export const MicIcon = icon(
  <>
    <rect x="7.5" y="2" width="5" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 10C4 13.3 6.7 16 10 16C13.3 16 16 13.3 16 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 16V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const SendIcon = icon(
  <path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
)

// ---- Window Controls ----

export const MinimizeIcon = icon(
  <path d="M5 10H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

export const MaximizeIcon = icon(
  <rect x="4" y="4" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
)

export const RestoreIcon = icon(
  <>
    <rect x="3" y="6" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 6V4.5C6 3.7 6.7 3 7.5 3H15.5C16.3 3 17 3.7 17 4.5V12.5C17 13.3 16.3 14 15.5 14H14" stroke="currentColor" strokeWidth="1.5" />
  </>
)

export const CloseWindowIcon = icon(
  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

// ---- Settings / Profile ----

export const SettingsIcon = icon(
  <>
    <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 2V4M10 16V18M18 10H16M4 10H2M15.7 4.3L14.3 5.7M5.7 14.3L4.3 15.7M15.7 15.7L14.3 14.3M5.7 5.7L4.3 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const SignOutIcon = icon(
  <path d="M7 2.5H13.5M4 5.5H16M14.5 5.5L14 15C14 16.1 13.1 17 12 17H8C6.9 17 6 16.1 6 15L5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const LinkIcon = icon(
  <>
    <path d="M8 5H5C3.9 5 3 5.9 3 7V15C3 16.1 3.9 17 5 17H13C14.1 17 15 16.1 15 15V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11 3H17V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17 3L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const RefreshIcon = icon(
  <>
    <path d="M2.5 10C2.5 5.9 5.9 2.5 10 2.5C14.1 2.5 17.5 5.9 17.5 10C17.5 14.1 14.1 17.5 10 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M2.5 10H5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const InfoIcon = icon(
  <>
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 6V9.5M10 13V13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

// ---- Chevrons ----

export const ChevronUpIcon = icon(
  <path d="M5 12.5L10 7.5L15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const ChevronDownIcon = icon(
  <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const ChevronLeftIcon = icon(
  <path d="M13.5 5L8.5 10L13.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

// ---- Small variants (16x16) for menus / nested use ----

const smallDefaults: IconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': true,
}

function smallIcon(paths: React.ReactNode) {
  return function SmallIcon(props: IconProps) {
    return <svg {...smallDefaults} {...props}>{paths}</svg>
  }
}

export const SearchSmallIcon = smallIcon(
  <>
    <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
)

export const EditSmallIcon = smallIcon(
  <>
    <path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </>
)

export const InfoSmallIcon = smallIcon(
  <>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 5V8M8 10.5V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
)

export const DeleteSmallIcon = smallIcon(
  <>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
)

export const ReplySmallIcon = smallIcon(
  <>
    <path d="M6 4L2 8L6 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 8H10C12.2 8 14 9.8 14 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
)

export const PinSmallIcon = smallIcon(
  <>
    <path d="M10 2L12.5 4.5L9 8V11L7 9L3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M5.5 5.5L9.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
)

export const CopySmallIcon = smallIcon(
  <>
    <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M11 5V3.5C11 2.7 10.3 2 9.5 2H3.5C2.7 2 2 2.7 2 3.5V9.5C2 10.3 2.7 11 3.5 11H5" stroke="currentColor" strokeWidth="1.3" />
  </>
)

export const DeleteSmallTrashIcon = smallIcon(
  <path d="M3 4H13M5.5 4V3C5.5 2.4 5.9 2 6.5 2H9.5C10.1 2 10.5 2.4 10.5 3V4M4.5 4V13C4.5 13.6 4.9 14 5.5 14H10.5C11.1 14 11.5 13.6 11.5 13V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
)

export const PhotoSmallIcon = smallIcon(
  <>
    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
    <path d="M2 11L5.5 7.5L8 10L10 8L14 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </>
)

export const FileSmallIcon = smallIcon(
  <>
    <path d="M9 2H4C3.4 2 3 2.4 3 3V13C3 13.6 3.4 14 4 14H12C12.6 14 13 13.6 13 13V6L9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2V6H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </>
)

export const CloseSmallIcon = smallIcon(
  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
)

export const ChevronUpSmallIcon = smallIcon(
  <path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const ChevronDownSmallIcon = smallIcon(
  <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
)

export const ClearCircleIcon = smallIcon(
  <>
    <circle cx="7" cy="7" r="6" fill="var(--label3)" />
    <path d="M5 5L9 9M9 5L5 9" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
  </>,
)

// ---- Media / Playback ----

export const PlayIcon = icon(
  <path d="M6 4L16 10L6 16V4Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
)

export const PauseIcon = icon(
  <>
    <path d="M7 4V16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M13 4V16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </>
)

export const VideoCamIcon = icon(
  <>
    <rect x="2" y="5.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 8.5L18 6V14L14 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
)

export const VolumeOffIcon = icon(
  <>
    <path d="M4 7.5H7.5L12 4V16L7.5 12.5H4V7.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M15 7.5L18.5 11M18.5 7.5L15 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const VolumeOnIcon = icon(
  <>
    <path d="M4 7.5H7.5L12 4V16L7.5 12.5H4V7.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M15 7.5C16.1 8.6 16.1 11.4 15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

// ---- Settings nav ----

export const NotificationsIcon = icon(
  <>
    <path d="M10 2.5V2M10 2.5C7 2.5 5 5 5 8V13L3 15H17L15 13V8C15 5 13 2.5 10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 15C8 16.1 8.9 17 10 17C11.1 17 12 16.1 12 15" stroke="currentColor" strokeWidth="1.5" />
  </>
)

export const ShieldIcon = icon(
  <path d="M10 2.5L4 5V10C4 13.5 6.7 16.7 10 17.5C13.3 16.7 16 13.5 16 10V5L10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
)

export const DevicesIcon = icon(
  <>
    <rect x="2.5" y="4" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 7.5H16.5C17.3 7.5 18 8.2 18 9V14C18 14.8 17.3 15.5 16.5 15.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M7 14.5V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)

export const LockIcon = icon(
  <>
    <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 9V6.5C7 4.6 8.3 3 10 3C11.7 3 13 4.6 13 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="10" cy="13.5" r="1.5" fill="currentColor" />
  </>
)

export const AdvancedIcon = icon(
  <>
    <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 2V4.5M10 15.5V18M2 10H4.5M15.5 10H18M4.4 4.4L6.2 6.2M13.8 13.8L15.6 15.6M15.6 4.4L13.8 6.2M6.2 13.8L4.4 15.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>
)
