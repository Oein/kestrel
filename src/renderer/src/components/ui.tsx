// Shared Mailbird primitives. Every screen builds on these so the look stays consistent.
import type { Address } from '../../../shared/types'
import { avatarColor, initials } from '../lib/format'
import { ACCOUNT_ICONS } from '../lib/accountIcons'
import { usePrefs } from '../lib/prefs'
import { Icon, type IconName } from './Icon'

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

export function Checkbox(props: {
  checked: boolean
  indeterminate?: boolean
  onChange: (e: { shiftKey: boolean }) => void
  title?: string
  className?: string
}): React.JSX.Element {
  const on = props.checked || props.indeterminate
  return (
    <button
      role="checkbox"
      aria-checked={props.indeterminate ? 'mixed' : props.checked}
      title={props.title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        props.onChange(e)
      }}
      className={cx(
        'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] transition-colors duration-100',
        on
          ? 'bg-accent text-accent-ink'
          : 'border-[1.5px] border-line-strong bg-surface hover:border-ink-3',
        props.className
      )}
    >
      {props.indeterminate ? (
        <span className="animate-scale-in h-[1.5px] w-2 rounded bg-current" />
      ) : props.checked ? (
        <Icon name="check" size={11} stroke={2.4} className="animate-scale-in" />
      ) : null}
    </button>
  )
}

export function IconButton(props: {
  icon: IconName
  title: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  size?: 'sm' | 'md'
  className?: string
  iconClassName?: string
}): React.JSX.Element {
  const sm = props.size === 'sm'
  return (
    <button
      title={props.title}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className={cx(
        'no-drag flex items-center justify-center rounded-md transition-colors duration-100',
        sm ? 'h-6 w-6' : 'h-7 w-7',
        props.active ? 'bg-active text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
        props.danger && 'hover:text-danger',
        props.className
      )}
    >
      <Icon name={props.icon} size={sm ? 14 : 16} className={props.iconClassName} />
    </button>
  )
}

export const btn = {
  primary:
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-40',
  secondary:
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-40',
  ghost:
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40',
  link: 'text-[12.5px] font-medium text-ink-2 hover:text-ink',
  danger: 'text-[12.5px] font-medium text-danger/80 hover:text-danger'
}

export const inputCls =
  'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] text-ink outline-none transition-[border,box-shadow] focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]'

export function Field(props: { label: string; hint?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-2">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1.5 block text-[12px] text-ink-3">{props.hint}</span>}
    </label>
  )
}

export function Avatar({ addr, size = 32 }: { addr: Address; size?: number }): React.JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(addr.email || addr.name) }}
    >
      {initials(addr)}
    </span>
  )
}

/** Square account badge: first letter on the account colour. */
export function AccountMark({ id, email, color, size = 18 }: { id?: string; email: string; color: string; size?: number }): React.JSX.Element {
  const look = usePrefs((s) => (id ? s.accountLooks[id] : undefined))
  const text = look?.text || email[0]?.toUpperCase()
  const Glyph = look?.icon ? ACCOUNT_ICONS[look.icon] : undefined
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * (text.length > 1 ? 0.36 : size > 24 ? 0.44 : 0.56),
        background: look?.image ? 'transparent' : (look?.color ?? color),
        borderRadius: Math.round(size * 0.29)
      }}
    >
      {look?.image ? (
        <img src={look.image} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : Glyph ? (
        <Glyph size={Math.round(size * 0.52)} strokeWidth={size > 24 ? 2 : 2.4} />
      ) : (
        text
      )}
    </span>
  )
}

export function LabelChip({ name, color }: { name: string; color: string | null }): React.JSX.Element {
  return (
    <span className="inline-flex h-[18px] max-w-[120px] shrink-0 items-center gap-1 rounded-[5px] border border-line px-1.5 text-[11px] font-medium text-ink-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color ?? 'var(--ink-3)' }} />
      <span className="truncate">{name}</span>
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return <Icon name="spinner" size={size} className="text-ink-3" />
}
