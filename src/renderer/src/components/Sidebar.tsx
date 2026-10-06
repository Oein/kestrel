import { useMemo, useState } from 'react'
import type { Mailbox, MailboxRole } from '../../../shared/types'
import { goLabel, goRole, openCompose, setAccountFilter, useStore } from '../store'
import { Icon, type IconName } from './Icon'

const NAV: { role: MailboxRole; label: string; icon: IconName; count?: boolean }[] = [
  { role: 'inbox', label: '받은편지함', icon: 'inbox', count: true },
  { role: 'starred', label: '별표편지함', icon: 'star' },
  { role: 'sent', label: '보낸편지함', icon: 'send' },
  { role: 'drafts', label: '임시보관함', icon: 'draft', count: true },
  { role: 'all', label: '전체보관함', icon: 'all' },
  { role: 'junk', label: '스팸', icon: 'spam', count: true },
  { role: 'trash', label: '휴지통', icon: 'trash' }
]

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

function NavItem(props: {
  active: boolean
  icon?: IconName
  color?: string | null
  label: string
  count?: number
  depth?: number
  onClick: () => void
  hasChildren?: boolean
  expanded?: boolean
  onToggle?: () => void
}): React.JSX.Element {
  const { active, icon, color, label, count, depth = 0, onClick, hasChildren, expanded, onToggle } = props
  return (
    <button
      onClick={onClick}
      className={`group flex h-8 w-full items-center gap-3 rounded-r-full pr-3 text-left text-[13.5px] ${
        active
          ? 'bg-accent-soft font-semibold text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]'
          : 'hover:bg-black/5 dark:hover:bg-white/5'
      }`}
      style={{ paddingLeft: 20 + depth * 14 }}
    >
      {hasChildren ? (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
          className="-ml-4 -mr-2 opacity-60"
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} />
        </span>
      ) : null}
      {icon ? (
        <Icon name={icon} size={18} className={active ? '' : 'opacity-75'} />
      ) : (
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color ?? '#8a8f98' }} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={`text-xs ${active ? '' : 'font-semibold'}`}>{count > 999 ? '999+' : count}</span> : null}
    </button>
  )
}

function LabelTree({ nodes, depth = 0 }: { nodes: LabelNode[]; depth?: number }): React.JSX.Element {
  const view = useStore((s) => s.view)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <>
      {nodes.map((n) => {
        const key = n.mailbox?.id ?? `${depth}:${n.name}`
        const open = !collapsed[key]
        return (
          <div key={key}>
            <NavItem
              active={view.kind === 'label' && view.mailboxId === n.mailbox?.id}
              color={n.mailbox?.colorBg}
              label={n.name}
              count={n.mailbox?.unread}
              depth={depth}
              hasChildren={n.children.length > 0}
              expanded={open}
              onToggle={() => setCollapsed({ ...collapsed, [key]: open })}
              onClick={() => n.mailbox && goLabel(n.mailbox.id, n.mailbox.accountId)}
            />
            {open && n.children.length > 0 && <LabelTree nodes={n.children} depth={depth + 1} />}
          </div>
        )
      })}
    </>
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

  const inboxUnreadByAccount = useMemo(() => {
    const out: Record<string, number> = {}
    for (const mb of mailboxes) if (mb.role === 'inbox') out[mb.accountId] = (out[mb.accountId] ?? 0) + mb.unread
    return out
  }, [mailboxes])

  const labelGroups = useMemo(() => {
    const visible = accounts.filter((a) => !filter || a.id === filter)
    return visible
      .map((a) => ({
        account: a,
        tree: buildTree(mailboxes.filter((m) => m.accountId === a.id && m.type === 'user'))
      }))
      .filter((g) => g.tree.length > 0)
  }, [accounts, mailboxes, filter])

  const syncing = Object.values(statuses).some((s) => s.state === 'syncing')
  const totalUnread = Object.values(inboxUnreadByAccount).reduce((a, b) => a + b, 0)

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col">
      <div className="drag h-[52px] shrink-0" />
      <div className="px-3 pb-3">
        <button
          onClick={() => openCompose()}
          className="no-drag flex h-14 items-center gap-3 rounded-2xl bg-[#c2e7ff] px-5 font-medium text-[#001d35] shadow-sm transition hover:shadow-md dark:bg-[#004a77] dark:text-[#c2e7ff]"
          title="편지쓰기 (c)"
        >
          <Icon name="pencil" />
          편지쓰기
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto pb-4 pr-2">
        {NAV.map((n) => (
          <NavItem
            key={n.role}
            active={view.kind === 'role' && view.role === n.role}
            icon={n.icon}
            label={n.label}
            count={n.count ? roleCounts[n.role] : undefined}
            onClick={() => goRole(n.role)}
          />
        ))}

        {labelGroups.map((g) => (
          <div key={g.account.id} className="mt-4">
            <div className="flex items-center gap-2 px-5 pb-1 text-xs font-medium text-black/50 dark:text-white/50">
              <span>라벨</span>
              {accounts.length > 1 && !filter && <span className="truncate">· {g.account.email}</span>}
            </div>
            <LabelTree nodes={g.tree} />
          </div>
        ))}

        <div className="mt-5 px-5 pb-1 text-xs font-medium text-black/50 dark:text-white/50">계정</div>
        {accounts.length > 1 && (
          <AccountItem
            active={filter === null}
            color={null}
            label="모든 계정"
            count={totalUnread}
            onClick={() => setAccountFilter(null)}
          />
        )}
        {accounts.map((a) => (
          <AccountItem
            key={a.id}
            active={filter === a.id || accounts.length === 1}
            color={a.color}
            label={a.email}
            count={inboxUnreadByAccount[a.id]}
            warn={a.needsReauth || statuses[a.id]?.state === 'error'}
            offline={statuses[a.id]?.state === 'offline'}
            onClick={() => setAccountFilter(a.id)}
          />
        ))}
        <button
          onClick={() => useStore.setState({ addAccountOpen: true })}
          className="flex h-8 w-full items-center gap-3 rounded-r-full pl-5 text-left text-[13px] text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
        >
          <Icon name="plus" size={18} />
          계정 추가
        </button>
      </nav>
      <div className="flex items-center gap-2 border-t border-black/5 px-4 py-2 text-xs text-black/50 dark:border-white/5 dark:text-white/50">
        <span className={`h-2 w-2 rounded-full ${syncing ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
        <span className="flex-1">{syncing ? '동기화 중...' : '최신 상태'}</span>
        <button
          title="설정"
          onClick={() => useStore.setState({ settingsOpen: true })}
          className="rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </aside>
  )
}

function AccountItem(props: {
  active: boolean
  color: string | null
  label: string
  count?: number
  warn?: boolean
  offline?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={props.onClick}
      className={`flex h-8 w-full items-center gap-3 rounded-r-full pl-5 pr-3 text-left text-[13px] ${
        props.active ? 'bg-black/[.07] font-medium dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {props.color ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: props.color }} />
      ) : (
        <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-[#4f86f7] via-[#e8710a] to-[#1e8e3e]" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.warn && <Icon name="warning" size={14} className="text-amber-500" />}
      {props.offline && <Icon name="cloudOff" size={14} className="opacity-60" />}
      {props.count ? <span className="text-xs font-semibold">{props.count}</span> : null}
    </button>
  )
}
