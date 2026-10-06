// Stroke icon set (lucide). Keep the name-based API so call sites stay small.
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  Bird,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Columns2,
  Command,
  CornerDownLeft,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Forward,
  Image,
  Inbox,
  KeyRound,
  Layers,
  LoaderCircle,
  Mail,
  MailOpen,
  Maximize2,
  Megaphone,
  Menu,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Server,
  Settings,
  ShieldAlert,
  SquarePen,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
  Undo2,
  User,
  Users,
  X,
  type LucideIcon
} from 'lucide-react'

const ICONS = {
  inbox: Inbox,
  star: Star,
  starFilled: Star,
  send: Send,
  draft: FileText,
  trash: Trash2,
  archive: Archive,
  all: Layers,
  spam: ShieldAlert,
  label: Tag,
  pencil: SquarePen,
  search: Search,
  close: X,
  back: ArrowLeft,
  reply: Reply,
  replyAll: ReplyAll,
  forward: Forward,
  attach: Paperclip,
  markUnread: Mail,
  markRead: MailOpen,
  refresh: RefreshCw,
  settings: Settings,
  plus: Plus,
  split: Columns2,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  minimize: Minus,
  shrink: Minimize2,
  expand: Maximize2,
  image: Image,
  download: Download,
  openExt: ExternalLink,
  warning: TriangleAlert,
  cloudOff: CloudOff,
  cloud: Cloud,
  server: Server,
  menu: Menu,
  person: User,
  people: Users,
  promo: Megaphone,
  bell: Bell,
  key: KeyRound,
  check: Check,
  more: Ellipsis,
  restore: ArchiveRestore,
  undo: Undo2,
  bird: Bird,
  command: Command,
  enter: CornerDownLeft,
  mail: Mail,
  spinner: LoaderCircle,
  eye: Eye,
  eyeOff: EyeOff
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 16,
  className = '',
  stroke = 1.75
}: {
  name: IconName
  size?: number
  className?: string
  stroke?: number
}): React.JSX.Element {
  const C = ICONS[name]
  return (
    <C
      size={size}
      strokeWidth={stroke}
      absoluteStrokeWidth
      className={`shrink-0 ${name === 'starFilled' ? 'fill-current' : ''} ${name === 'spinner' ? 'animate-spin' : ''} ${className}`}
      aria-hidden
    />
  )
}
