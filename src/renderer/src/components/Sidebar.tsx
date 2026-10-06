import { useMemo, useState } from 'react'
import type { Mailbox, MailboxRole } from '../../../shared/types'
import { relative } from '../lib/format'
import { setDrawer, useLayout } from '../lib/layout'
import { toggleSidebarHidden, usePrefs } from '../lib/prefs'
import { create } from 'zustand'
import { goLabel, goRole, openCompose, setAccountFilter, toast, useStore } from '../store'
import { Icon, type IconName } from './Icon'
import { editAccountLook } from './AccountLook'
import { openSettings } from './Dialogs'
import { AccountMark, cx, IconButton } from './ui'

const NAV: { role: MailboxRole; label: string; icon: IconName; count?: boolean; keys?: string }[] = [
  { role: 'inbox', label: '받은편지함', icon: 'inbox', count: true, keys: 'G I' },
  { role: 'starred', label: '별표', icon: 'star', keys: 'G S' },
  { role: 'sent', label: '보낸편지함', icon: 'send', keys: 'G T' },
  { role: 'drafts', label: '임시보관함', icon: 'draft', count: true, keys: 'G D' },
  { role: 'all', label: '전체 메일', icon: 'all', keys: 'G A' },
  { role: 'junk', label: '스팸', icon: 'spam', count: true },
  { role: 'trash', label: '휴지통', icon: 'trash' }
]

const useSidebarEdit = create<{ on: boolean }>(() => ({ on: false }))

function hideWithUndo(key: string, label: string): void {
  toggleSidebarHidden(key, true)
  toast('info', `'${label}'을(를) 사이드바에서 숨겼습니다`, { label: '실행취소', run: () => toggleSidebarHidden(key, false) })
}

/** Eye toggle shown next to every entry while editing the sidebar. */
function VisibilityToggle({ hideKey }: { hideKey: string }): React.JSX.Element {
  const hidden = usePrefs((s) => s.sidebarHidden.includes(hideKey))
  return (
    <span
      role="button"
      title={hidden ? '보이기' : '숨기기'}
      onClick={(e) => {
        e.stopPropagation()
        toggleSidebarHidden(hideKey)
      }}
      className={cx('flex h-5 w-5 items-center justify-center rounded hover:bg-active', hidden ? 'text-ink-3' : 'text-ink-2')}
    >
      <Icon name={hidden ? 'eyeOff' : 'eye'} size={13} />
    </span>
  )
}

/** Hidden entries disappear unless the sidebar is being edited (then they're dimmed). */
function useVisibility(hideKey: string | undefined): 'show' | 'dim' | 'gone' {
  const hidden = usePrefs((s) => (hideKey ? s.sidebarHidden.includes(hideKey) : false))
  const editing = useSidebarEdit((s) => s.on)
  return !hidden ? 'show' : editing ? 'dim' : 'gone'
}

interface LabelNode {
  name: string
  mailbox: Mailbox | null
  children: LabelNode[]
}

function buildTree(list: Mailbox[]): LabelNode[] {
  const root: LabelNode[] = []
  for (const mb of [...list].sort((a, b) => a.path.localeCompare(b.path, 'ko'))) {
    const parts = mb.path.split('/')
    let level = root
    parts.forEach((part, i) => {
      let node = level.find((n) => n.name === part)
      if (!node) {
        node = { name: part, mailbox: null, children: [] }
        level.push(node)
      }
      if (i === parts.length - 1) node.mailbox = mb
      level = node.children
    })
  }
  return root
}

function Item(props: {
  active: boolean
  label: string
  onClick: () => void
  icon?: React.ReactNode
  count?: number
  strongCount?: boolean
  depth?: number
  title?: string
  trailing?: React.ReactNode
  hideKey?: string
}): React.JSX.Element | null {
  const { active, depth = 0, hideKey } = props
  const vis = useVisibility(hideKey)
  const editing = useSidebarEdit((s) => s.on)
  if (vis === 'gone') return null
  return (
    <button
      onClick={props.onClick}
      onContextMenu={(e) => {
        if (!hideKey) return
        e.preventDefault()
        hideWithUndo(hideKey, props.label)
      }}
      title={props.title}
      className={cx(
        'group flex h-[30px] w-full items-center gap-2.5 rounded-md pr-2 text-left text-[13px] transition-colors duration-75',
        vis === 'dim' && 'opacity-40',
        active ? 'bg-active font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className={cx('flex w-4 justify-center', active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')}>{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing}
      {editing && hideKey ? (
        <VisibilityToggle hideKey={hideKey} />
      ) : props.count ? (
        <span className={cx('tnum text-[11.5px]', props.strongCount ? 'font-semibold text-ink' : 'text-ink-3')}>
          {props.count > 999 ? '999+' : props.count}
        </span>
      ) : null}
    </button>
  )
}

const loadCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem('mailbird.sidebarCollapsed') ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
const collapsedSections = loadCollapsed()

/** Open/closed state that survives restarts (sections and label folders). */
function useCollapsible(id: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(!collapsedSections[id])
  const setOpen = (v: boolean): void => {
    setOpenState(v)
    if (v) delete collapsedSections[id]
    else collapsedSections[id] = true
    try {
      localStorage.setItem('mailbird.sidebarCollapsed', JSON.stringify(collapsedSections))
    } catch {
      /* ignore */
    }
  }
  return [open, setOpen]
}

function Section(props: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode; hideKey?: string }): React.JSX.Element | null {
  const [open, setOpen] = useCollapsible(props.id)
  const vis = useVisibility(props.hideKey)
  const editing = useSidebarEdit((s) => s.on)
  if (vis === 'gone') return null
  return (
    <div className={cx('mt-5', vis === 'dim' && 'opacity-40')}>
      <div
        className="group flex h-6 items-center px-2"
        onContextMenu={(e) => {
          if (!props.hideKey) return
          e.preventDefault()
          hideWithUndo(props.hideKey, props.title)
        }}
      >
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap text-[11px] font-semibold tracking-wide text-ink-3 hover:text-ink-2">
          <span className="truncate">{props.title}</span>
          <Icon name="chevronDown" size={11} className={cx('opacity-0 transition-transform duration-150 group-hover:opacity-100', !open && '-rotate-90')} />
        </button>
        {editing && props.hideKey ? <VisibilityToggle hideKey={props.hideKey} /> : props.action}
      </div>
      {open && <div className="animate-slide-up mt-0.5 space-y-px">{props.children}</div>}
    </div>
  )
}

function LabelNodeItem({ n, depth }: { n: LabelNode; depth: number }): React.JSX.Element {
  const view = useStore((s) => s.view)
  const key = n.mailbox?.id ?? `${depth}:${n.name}`
  const [open, setOpen] = useCollapsible(`tree:${key}`)
  const hasChildren = n.children.length > 0
  const dot = <span className="h-2 w-2 rounded-[3px]" style={{ background: n.mailbox?.colorBg ?? 'var(--ink-3)' }} />
  return (
    <div className="space-y-px">
      <Item
        active={view.kind === 'label' && view.mailboxId === n.mailbox?.id}
        depth={depth}
        hideKey={n.mailbox ? `label:${n.mailbox.id}` : undefined}
        icon={
          hasChildren ? (
            <span
              role="button"
              title={open ? '접기' : '펼치기'}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(!open)
              }}
              className="relative -ml-3.5 flex h-4 w-[30px] items-center justify-end gap-1"
            >
              <Icon
                name="chevronDown"
                size={11}
                className={cx('text-ink-3 transition-transform duration-150 hover:text-ink', !open && '-rotate-90')}
              />
              {dot}
            </span>
          ) : (
            dot
          )
        }
        label={n.name}
        count={n.mailbox?.unread || (!open ? sumUnread(n.children) : 0)}
        onClick={() => n.mailbox && goLabel(n.mailbox.id, n.mailbox.accountId)}
      />
      {open && hasChildren && (
        <div className="animate-slide-up space-y-px">
          <LabelTree nodes={n.children} depth={depth + 1} />
        </div>
      )}
    </div>
  )
}

const sumUnread = (nodes: LabelNode[]): number => nodes.reduce((a, n) => a + (n.mailbox?.unread ?? 0) + sumUnread(n.children), 0)

function LabelTree({ nodes, depth = 0 }: { nodes: LabelNode[]; depth?: number }): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => (
        <LabelNodeItem key={n.mailbox?.id ?? `${depth}:${n.name}`} n={n} depth={depth} />
      ))}
    </>
  )
}

/** Unread inbox count per account. */
function useInboxUnread(): Record<string, number> {
  const mailboxes = useStore((s) => s.mailboxes)
  return useMemo(() => {
    const out: Record<string, number> = {}
    for (const mb of mailboxes) if (mb.role === 'inbox') out[mb.accountId] = (out[mb.accountId] ?? 0) + mb.unread
    return out
  }, [mailboxes])
}

/** Switch account scope with ⌘1 (all accounts) and ⌘2…⌘9, in rail order. */
export function accountByShortcut(n: number): void {
  const { accounts } = useStore.getState()
  const scopes: (string | null)[] = accounts.length > 1 ? [null, ...accounts.map((a) => a.id)] : accounts.map((a) => a.id)
  if (n - 1 < scopes.length) setAccountFilter(scopes[n - 1])
}

function RailItem(props: {
  active: boolean
  label: string
  sub?: string
  count?: number
  warn?: boolean
  shortcut?: string
  onClick: () => void
  onContextMenu?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [tip, setTip] = useState<DOMRect | null>(null)
  return (
    <div className="relative flex w-full justify-center">
      <span
        className={cx(
          'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-ink transition-[height,opacity] duration-200',
          props.active ? 'h-5 opacity-100' : 'h-2 opacity-0'
        )}
        style={{ transitionTimingFunction: 'var(--ease-out)' }}
      />
      <button
        onClick={props.onClick}
        onContextMenu={(e) => {
          if (!props.onContextMenu) return
          e.preventDefault()
          setTip(null)
          props.onContextMenu()
        }}
        onMouseEnter={(e) => setTip(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setTip(null)}
        className={cx(
          'relative rounded-[11px] transition-[transform,box-shadow,opacity] duration-150 hover:scale-[1.06]',
          props.active ? 'shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--accent)]' : 'opacity-80 hover:opacity-100'
        )}
      >
        {props.children}
        {props.count ? (
          <span className="tnum animate-scale-in absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink shadow-[0_0_0_2px_var(--bg)]">
            {props.count > 99 ? '99+' : props.count}
          </span>
        ) : null}
        {props.warn && (
          <span className="absolute -bottom-1 -right-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-warn text-[10px] font-bold text-white shadow-[0_0_0_2px_var(--bg)]">
            !
          </span>
        )}
      </button>
      {tip && (
        <div
          className="animate-fade pointer-events-none fixed z-[70] flex items-center gap-2 whitespace-nowrap rounded-lg bg-[#1f1e1b] px-2.5 py-1.5 text-[12px] text-[#f1efea] shadow-float dark:bg-[#f1efea] dark:text-[#1f1e1b]"
          style={{ left: tip.right + 10, top: tip.top + tip.height / 2, transform: 'translateY(-50%)' }}
        >
          <span className="font-semibold">{props.label}</span>
          {props.sub && <span className="opacity-60">{props.sub}</span>}
          {props.shortcut && <span className="rounded border border-current/25 px-1 text-[10.5px] opacity-60">{props.shortcut}</span>}
        </div>
      )}
    </div>
  )
}

/** Always-visible account switcher on the far left. */
export function AccountRail(): React.JSX.Element {
  const narrow = useLayout((s) => s.narrow)
  const drawerOpen = useLayout((s) => s.drawerOpen)
  const accounts = useStore((s) => s.accounts)
  const filter = useStore((s) => s.accountFilter)
  const statuses = useStore((s) => s.statuses)
  const unread = useInboxUnread()
  const multi = accounts.length > 1
  const total = Object.values(unread).reduce((a, b) => a + b, 0)
  const offset = multi ? 2 : 1
  return (
    <div className="flex h-full w-[64px] shrink-0 flex-col items-center border-r border-line bg-hover">
      <div className="drag h-[52px] w-full shrink-0" />
      {narrow && (
        <div className="mb-2 flex shrink-0 justify-center">
          <IconButton icon="menu" title="폴더 · 라벨" active={drawerOpen} onClick={() => setDrawer(!drawerOpen)} />
        </div>
      )}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto pb-3 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {multi && (
          <>
            <RailItem active={filter === null} label="모든 계정" sub={`${accounts.length}개`} count={total} shortcut="⌘1" onClick={() => setAccountFilter(null)}>
              <span className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-line-strong bg-surface text-ink-2">
                <Icon name="all" size={17} />
              </span>
            </RailItem>
            <span className="h-px w-6 shrink-0 bg-line-strong" />
          </>
        )}
        {accounts.map((a, i) => {
          const st = statuses[a.id]
          return (
            <RailItem
              key={a.id}
              active={filter === a.id || !multi}
              label={a.email}
              sub={a.provider === 'gmail' ? 'Gmail' : a.preset === 'icloud' ? 'iCloud' : a.preset === 'naver' ? '네이버' : 'IMAP'}
              count={unread[a.id]}
              warn={a.needsReauth || st?.state === 'error'}
              shortcut={i + offset <= 9 ? `⌘${i + offset}` : undefined}
              onClick={() => setAccountFilter(a.id)}
              onContextMenu={() => editAccountLook(a.id)}
            >
              <AccountMark id={a.id} email={a.email} color={a.color} size={36} />
            </RailItem>
          )
        })}
        <button
          title="계정 추가"
          onClick={() => useStore.setState({ addAccountOpen: true })}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-dashed border-line-strong text-ink-3 hover:border-ink-3 hover:bg-hover hover:text-ink"
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1 pb-3">
        <IconButton icon="command" title="명령 팔레트 (⌘K)" onClick={() => useStore.setState({ paletteOpen: true })} />
        <IconButton icon="settings" title="설정 (⌘,)" onClick={() => openSettings()} />
      </div>
    </div>
  )
}

function EditToggle(): React.JSX.Element {
  const editing = useSidebarEdit((s) => s.on)
  const hiddenCount = usePrefs((s) => s.sidebarHidden.length)
  if (editing)
    return (
      <button onClick={() => useSidebarEdit.setState({ on: false })} className="rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-semibold text-accent-ink">
        완료
      </button>
    )
  return (
    <button
      onClick={() => useSidebarEdit.setState({ on: true })}
      title="사이드바 편집 — 항목 숨기기/보이기 (항목을 우클릭해도 숨길 수 있습니다)"
      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-ink-3 hover:bg-hover hover:text-ink"
    >
      <Icon name={hiddenCount ? 'eyeOff' : 'eye'} size={13} />
      {hiddenCount > 0 && <span className="tnum text-[11px]">{hiddenCount}</span>}
    </button>
  )
}

export function Sidebar(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const mailboxes = useStore((s) => s.mailboxes)
  const view = useStore((s) => s.view)
  const filter = useStore((s) => s.accountFilter)
  const statuses = useStore((s) => s.statuses)

  const roleCounts = useMemo(() => {
    const out: Partial<Record<MailboxRole, number>> = {}
    for (const mb of mailboxes) {
      if (!mb.role || (filter && mb.accountId !== filter)) continue
      out[mb.role] = (out[mb.role] ?? 0) + mb.unread
    }
    return out
  }, [mailboxes, filter])

  const labelGroups = useMemo(() => {
    const visible = accounts.filter((a) => !filter || a.id === filter)
    return visible
      .map((a) => ({ account: a, tree: buildTree(mailboxes.filter((m) => m.accountId === a.id && m.type === 'user')) }))
      .filter((g) => g.tree.length > 0)
  }, [accounts, mailboxes, filter])

  const list = Object.values(statuses).filter((s) => !filter || s.accountId === filter)
  const syncing = list.some((s) => s.state === 'syncing')
  const failing = list.filter((s) => s.state === 'error' || s.state === 'offline').length
  const lastSync = Math.max(0, ...list.map((s) => s.lastSync ?? 0))
  const multi = accounts.length > 1
  const scope = accounts.find((a) => a.id === filter)

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col">
      <div className="drag flex h-[52px] shrink-0 items-end px-5 pb-1">
        <div key={filter ?? 'all'} className="animate-fade min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{scope ? scope.email.split('@')[0] : multi ? '모든 계정' : (accounts[0]?.email.split('@')[0] ?? 'Mailbird')}</div>
        </div>
      </div>
      <div className="truncate px-5 pb-3 text-[11.5px] text-ink-3">
        {scope ? `@${scope.email.split('@')[1]}` : multi ? `${accounts.length}개 계정 통합` : accounts[0] ? `@${accounts[0].email.split('@')[1]}` : ''}
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => openCompose()}
          className="group flex h-9 w-full items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-ink shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_1px_2px_rgba(0,0,0,.12)] transition-colors hover:bg-accent-hover"
        >
          <Icon name="pencil" size={15} stroke={2} />
          <span className="flex-1 text-left">새 메일</span>
          <kbd className="!border-white/25 !bg-white/15 !text-accent-ink">C</kbd>
        </button>
      </div>

      <nav key={filter ?? 'all'} className="animate-fade min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-px">
          {NAV.map((n) => (
            <Item
              key={n.role}
              active={view.kind === 'role' && view.role === n.role}
              icon={<Icon name={n.icon} size={15} />}
              label={n.label}
              title={n.keys ? `${n.label} (${n.keys})` : n.label}
              count={n.count ? roleCounts[n.role] : undefined}
              strongCount={n.role === 'inbox'}
              hideKey={n.role === 'inbox' ? undefined : `role:${n.role}`}
              onClick={() => goRole(n.role)}
            />
          ))}
        </div>

        {labelGroups.map((g) => (
          <Section
            key={g.account.id}
            id={`labels:${g.account.id}:${filter ? 'one' : 'all'}`}
            title={multi && !filter ? g.account.email.split('@')[0] : '라벨'}
            hideKey={`labels:${g.account.id}`}
          >
            <LabelTree nodes={g.tree} />
          </Section>
        ))}
      </nav>

      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line px-5 text-[11.5px] text-ink-3">
        {syncing ? (
          <Icon name="spinner" size={12} />
        ) : (
          <span className={cx('h-1.5 w-1.5 rounded-full', failing ? 'bg-warn' : 'bg-ok')} />
        )}
        <span className="flex-1 truncate">
          {syncing ? '동기화 중' : failing ? `${failing}개 계정 연결 문제` : lastSync ? `${relative(lastSync)} 동기화됨` : '대기 중'}
        </span>
        <EditToggle />
      </div>
    </aside>
  )
}
