/**
 * Centralized icon system for Vostok.
 * Uses Phosphor Icons (regular weight) with backward-compatible exports.
 */
import {
  MagnifyingGlass,
  PencilSimple,
  ArrowLeft,
  X,
  List,
  Phone,
  DotsThreeVertical,
  ArrowBendUpLeft,
  Pencil,
  PushPin,
  Copy,
  Trash,
  Paperclip,
  Image,
  File,
  Microphone,
  PaperPlaneRight,
  Minus,
  Square,
  CopySimple,
  Gear,
  SignOut,
  ArrowSquareOut,
  ArrowClockwise,
  Info,
  CaretUp,
  CaretDown,
  CaretLeft,
  Play,
  Pause,
  VideoCamera,
  SpeakerSlash,
  SpeakerHigh,
  Bell,
  Shield,
  Devices,
  Lock,
  Faders,
} from '@phosphor-icons/react'
import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react'

type IconProps = React.SVGProps<SVGSVGElement>

// Helper to wrap Phosphor icons to match old API (accepts SVG props)
function wrap(PhosphorIcon: React.ComponentType<PhosphorIconProps>, defaultSize = 20) {
  return function WrappedIcon(props: IconProps) {
    const { className, style, ...rest } = props
    return <PhosphorIcon size={defaultSize} className={className} style={style} weight="regular" />
  }
}

function wrapSmall(PhosphorIcon: React.ComponentType<PhosphorIconProps>) {
  return wrap(PhosphorIcon, 16)
}

// ---- Navigation ----
export const SearchIcon = wrap(MagnifyingGlass)
export const ComposeIcon = wrap(PencilSimple)
export const BackIcon = wrap(ArrowLeft)
export const CloseIcon = wrap(X)
export const HamburgerIcon = wrap(List)

// ---- Conversation ----
export const PhoneIcon = wrap(Phone)
export const MoreVertIcon = wrap(DotsThreeVertical)

// ---- Context Menu / Message Actions ----
export const ReplyIcon = wrap(ArrowBendUpLeft)
export const EditIcon = wrap(Pencil)
export const PinIcon = wrap(PushPin)
export const CopyIcon = wrap(Copy)
export const DeleteIcon = wrap(Trash)

// ---- Composer / Attach ----
export const AttachIcon = wrap(Paperclip)
export const PhotoIcon = wrap(Image)
export const FileIcon = wrap(File)
export const MicIcon = wrap(Microphone)
export const SendIcon = wrap(PaperPlaneRight)

// ---- Window Controls ----
export const MinimizeIcon = wrap(Minus)
export const MaximizeIcon = wrap(Square)
export const RestoreIcon = wrap(CopySimple)
export const CloseWindowIcon = wrap(X)

// ---- Settings / Profile ----
export const SettingsIcon = wrap(Gear)
export const SignOutIcon = wrap(SignOut)
export const LinkIcon = wrap(ArrowSquareOut)
export const RefreshIcon = wrap(ArrowClockwise)
export const InfoIcon = wrap(Info)

// ---- Chevrons ----
export const ChevronUpIcon = wrap(CaretUp)
export const ChevronDownIcon = wrap(CaretDown)
export const ChevronLeftIcon = wrap(CaretLeft)

// ---- Small variants (16px) for menus / nested use ----
export const SearchSmallIcon = wrapSmall(MagnifyingGlass)
export const EditSmallIcon = wrapSmall(Pencil)
export const InfoSmallIcon = wrapSmall(Info)
export const DeleteSmallIcon = wrapSmall(X)
export const ReplySmallIcon = wrapSmall(ArrowBendUpLeft)
export const PinSmallIcon = wrapSmall(PushPin)
export const CopySmallIcon = wrapSmall(Copy)
export const DeleteSmallTrashIcon = wrapSmall(Trash)
export const PhotoSmallIcon = wrapSmall(Image)
export const FileSmallIcon = wrapSmall(File)
export const CloseSmallIcon = wrapSmall(X)
export const ChevronUpSmallIcon = wrapSmall(CaretUp)
export const ChevronDownSmallIcon = wrapSmall(CaretDown)

// ---- Custom icons (no Phosphor equivalent) ----
export function ClearCircleIcon(props: IconProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden={true} {...props}>
      <circle cx="8" cy="8" r="6" fill="var(--label3)" />
      <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ---- Media / Playback ----
export const PlayIcon = wrap(Play)
export const PauseIcon = wrap(Pause)
export const VideoCamIcon = wrap(VideoCamera)
export const VolumeOffIcon = wrap(SpeakerSlash)
export const VolumeOnIcon = wrap(SpeakerHigh)

// ---- Settings nav ----
export const NotificationsIcon = wrap(Bell)
export const ShieldIcon = wrap(Shield)
export const DevicesIcon = wrap(Devices)
export const LockIcon = wrap(Lock)
export const AdvancedIcon = wrap(Faders)
