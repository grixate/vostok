/**
 * Centralized icon system for Vostok.
 * Uses Lucide icons with backward-compatible exports.
 */
import {
  Search,
  SquarePen,
  ArrowLeft,
  X,
  Menu,
  Phone,
  Ellipsis,
  Reply,
  Pencil,
  Pin,
  Copy,
  Trash2,
  Paperclip,
  Image,
  FileText,
  Mic,
  Send,
  Minus,
  Square,
  CopyPlus,
  Settings,
  LogOut,
  ExternalLink,
  RefreshCw,
  Info,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Video,
  VolumeX,
  Volume2,
  Bell,
  Shield,
  Monitor,
  Lock,
  SlidersHorizontal,
  MessageCircle,
  Users,
  CheckCheck,
  Check,
  Languages,
  Share2,
  Archive,
  BellOff,
  CheckSquare,
  Link,
  EyeOff,
  Eye,
  PhoneOff,
  Plus,
  Code,
  Zap,
  User,
  PenLine,
  CircleCheck,
  CornerUpLeft,
  Smile,
  MapPin,
  MicOff,
  VideoOff,
  MonitorUp,
  PhoneCall,
  Maximize2,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

type IconProps = React.SVGProps<SVGSVGElement>

// Helper to wrap Lucide icons to match old API (accepts SVG props)
function wrap(LucideIcon: React.ComponentType<LucideProps>, defaultSize = 20) {
  return function WrappedIcon(props: IconProps) {
    const { className, style } = props
    return <LucideIcon size={defaultSize} className={className} style={style} strokeWidth={1.75} />
  }
}

function wrapSmall(LucideIcon: React.ComponentType<LucideProps>) {
  return wrap(LucideIcon, 16)
}

// ---- Navigation ----
export const SearchIcon = wrap(Search)
export const ComposeIcon = wrap(SquarePen)
export const BackIcon = wrap(ArrowLeft)
export const CloseIcon = wrap(X)
export const HamburgerIcon = wrap(Menu)

// ---- Conversation ----
export const PhoneIcon = wrap(Phone)
export const MoreVertIcon = wrap(Ellipsis)
export const VideoIcon = wrap(Video)

// ---- Context Menu / Message Actions ----
export const ReplyIcon = wrap(Reply)
export const EditIcon = wrap(Pencil)
export const PinIcon = wrap(Pin)
export const CopyIcon = wrap(Copy)
export const DeleteIcon = wrap(Trash2)
export const ForwardIcon = wrap(Share2)
export const TranslateIcon = wrap(Languages)
export const ArchiveIcon = wrap(Archive)
export const MuteIcon = wrap(BellOff)
export const SelectIcon = wrap(CheckSquare)

// ---- Status indicators ----
export const CheckIcon = wrap(Check)
export const CheckCheckIcon = wrap(CheckCheck)

// ---- Composer / Attach ----
export const AttachIcon = wrap(Paperclip)
export const PhotoIcon = wrap(Image)
export const FileIcon = wrap(FileText)
export const MicIcon = wrap(Mic)
export const SendIcon = wrap(Send)
export const SmileIcon = wrap(Smile)

// ---- Window Controls ----
export const MinimizeIcon = wrap(Minus)
export const MaximizeIcon = wrap(Square)
export const RestoreIcon = wrap(CopyPlus)
export const CloseWindowIcon = wrap(X)

// ---- Settings / Profile ----
export const SettingsIcon = wrap(Settings)
export const SignOutIcon = wrap(LogOut)
export const LinkIcon = wrap(ExternalLink)
export const RefreshIcon = wrap(RefreshCw)
export const InfoIcon = wrap(Info)
export const PlusIcon = wrap(Plus)
export const CodeIcon = wrap(Code)
export const LinkChainIcon = wrap(Link)
export const EyeOffIcon = wrap(EyeOff)
export const PhoneOffIcon = wrap(PhoneOff)
export const MonitorIcon = wrap(Monitor)
export const MicOffIcon = wrap(MicOff)
export const VideoOffIcon = wrap(VideoOff)
export const MonitorUpIcon = wrap(MonitorUp)
export const PhoneCallIcon = wrap(PhoneCall)
export const ExpandIcon = wrap(Maximize2)

// ---- Chevrons ----
export const ChevronUpIcon = wrap(ChevronUp)
export const ChevronDownIcon = wrap(ChevronDown)
export const ChevronLeftIcon = wrap(ChevronLeft)
export const ChevronRightIcon = wrap(ChevronRight)

// ---- Small variants (16px) for menus / nested use ----
export const SearchSmallIcon = wrapSmall(Search)
export const EditSmallIcon = wrapSmall(Pencil)
export const InfoSmallIcon = wrapSmall(Info)
export const DeleteSmallIcon = wrapSmall(X)
export const ReplySmallIcon = wrapSmall(CornerUpLeft)
export const PinSmallIcon = wrapSmall(Pin)
export const CopySmallIcon = wrapSmall(Copy)
export const DeleteSmallTrashIcon = wrapSmall(Trash2)
export const PhotoSmallIcon = wrapSmall(Image)
export const FileSmallIcon = wrapSmall(FileText)
export const CloseSmallIcon = wrapSmall(X)
export const ChevronUpSmallIcon = wrapSmall(ChevronUp)
export const ChevronDownSmallIcon = wrapSmall(ChevronDown)
export const ForwardSmallIcon = wrapSmall(Share2)
export const TranslateSmallIcon = wrapSmall(Languages)
export const SelectSmallIcon = wrapSmall(CircleCheck)
export const ChevronRightSmallIcon = wrapSmall(ChevronRight)
export const UserSmallIcon = wrapSmall(User)
export const UsersSmallIcon = wrapSmall(Users)
export const MapPinSmallIcon = wrapSmall(MapPin)
export const CheckCheckSmallIcon = wrapSmall(CheckCheck)
export const MuteSmallIcon = wrapSmall(BellOff)
export const ArchiveSmallIcon = wrapSmall(Archive)
export const SignOutSmallIcon = wrapSmall(LogOut)

// ---- Custom icons (no Lucide equivalent) ----
export function ClearCircleIcon(props: IconProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden={true} {...props}>
      <circle cx="8" cy="8" r="6" fill="var(--text-muted)" />
      <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ---- Media / Playback ----
export const PlayIcon = wrap(Play)
export const PauseIcon = wrap(Pause)
export const VideoCamIcon = wrap(Video)
export const VolumeOffIcon = wrap(VolumeX)
export const VolumeOnIcon = wrap(Volume2)

// ---- Settings nav ----
export const NotificationsIcon = wrap(Bell)
export const ShieldIcon = wrap(Shield)
export const DevicesIcon = wrap(Monitor)
export const LockIcon = wrap(Lock)
export const AdvancedIcon = wrap(SlidersHorizontal)

// ---- Tab bar ----
export const ChatsIcon = wrap(MessageCircle)
export const MembersIcon = wrap(Users)

// Filled variants for active tab state
function wrapFilled(LucideIcon: React.ComponentType<LucideProps>, defaultSize = 24) {
  return function WrappedIcon(props: IconProps) {
    const { className, style } = props
    return <LucideIcon size={defaultSize} className={className} style={style} strokeWidth={1.75} fill="currentColor" />
  }
}

export const ChatsFilledIcon = wrapFilled(MessageCircle)
export const MembersFilledIcon = wrapFilled(Users)
export const SettingsFilledIcon = wrapFilled(Settings)

// ---- Auth icons ----
export const ZapIcon = wrap(Zap)
export const UserIcon = wrap(User)
export const EyeIcon = wrap(Eye)
export const PenLineIcon = wrap(PenLine)
export const CircleCheckIcon = wrap(CircleCheck)
