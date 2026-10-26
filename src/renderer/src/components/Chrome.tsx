import { useEffect, useMemo, useRef, useState } from 'react'
import type { MailboxRole } from '../../../shared/types'
import {
  act,
  api,
  dismissToast,
  goLabel,
  goRole,
  openCompose,
  runSearch,
  setAccountFilter,
  setReadingPane,
  setSearchText,
  toggleUnreadOnly,
  useStore
} from '../store'
import { Icon, type IconName } from './Icon'
import { shortSize } from '../lib/format'
import { useLeaving } from '../lib/motion'
import { setPref, usePrefs } from '../lib/prefs'
import { openSettings } from './Dialogs'
import { AccountMark, cx } from './ui'

export function Toasts(): React.JSX.Element {
  const toasts = useLeaving(useStore((s) => s.toasts))
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${t.leaving ? 'animate-sink pointer-events-none' : 'animate-rise pointer-events-auto'} relative flex h-10 max-w-[560px] items-center gap-3 overflow-hidden rounded-xl bg-[#1f1e1b] pl-3.5 pr-1.5 text-[13px] text-[#f1efea] shadow-float dark:bg-[#f1efea] dark:text-[#1f1e1b]`}
        >
          {t.progress ? (
            <Icon name="download" size={15} className="text-[#ff9a76] dark:text-accent" />
          ) : t.kind === 'error' ? (
            <Icon name="warning" size={15} className="text-[#ff8a75] dark:text-danger" />
          ) : t.kind === 'success' ? (
            <Icon name="check" size={15} className="text-[#5fd3a0] dark:text-ok" />
          ) : null}
          <span className={cx('truncate', t.progress && 'max-w-[240px]')}>{t.message}</span>
          {t.progress && <DownloadStats {...t.progress} />}
          {t.action && (
            <button
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 font-semibold text-[#ff9a76] hover:bg-white/10 dark:text-accent dark:hover:bg-black/5"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
              {t.action.label === '실행취소' && <span className="rounded border border-current/30 px-1 text-[10.5px] opacity-70">Z</span>}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} className="flex h-7 w-7 items-center justify-center rounded-lg opacity-50 hover:bg-white/10 hover:opacity-100 dark:hover:bg-black/5">
            <Icon name="close" size={14} />
          </button>
          {t.progress && t.progress.total > 0 && (
            <span
              className="absolute bottom-0 left-0 h-[2px] bg-[#ff9a76] transition-[width] duration-150 ease-linear dark:bg-accent"
              style={{ width: `${(t.progress.loaded / t.progress.total) * 100}%` }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function DownloadStats({ loaded, total, rate }: { loaded: number; total: number; rate: number }): React.JSX.Element {
  return (
    <span className="tnum flex shrink-0 items-center gap-2 text-[12px] opacity-70">
      {total > 0 && <span className="font-semibold opacity-100">{Math.floor((loaded / total) * 100)}%</span>}
      <span>{total > 0 ? `${shortSize(loaded)}/${shortSize(total)}` : shortSize(loaded)}</span>
      <span>{shortSize(rate)}/s</span>
    </span>
  )
}

interface Command {
  id: string
  group: string
  label: string
  icon?: IconName
  mark?: React.ReactNode
  keys?: string[]
  hint?: string
  run: () => void
}

function match(c: Command, q: string): boolean {
  const hay = `${c.label} ${c.hint ?? ''} ${c.group}`.toLowerCase()
  return q.split(/\s+/).every((w) => hay.includes(w))
}

export function CommandPalette({ closing }: { closing?: boolean }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const accounts = useStore((s) => s.accounts)
  const mailboxes = useStore((s) => s.mailboxes)
  const readingPane = useStore((s) => s.readingPane)
  const density = usePrefs((s) => s.density)
  const unreadOnly = useStore((s) => s.unreadOnly)
  const listRef = useRef<HTMLDivElement>(null)
  const close = (): void => useStore.setState({ paletteOpen: false })

  const commands = useMemo<Command[]>(() => {
    const roles: [MailboxRole, string, IconName, string[]?][] = [
      ['inbox', '받은편지함', 'inbox', ['G', 'I']],
      ['starred', '별표', 'star', ['G', 'S']],
      ['sent', '보낸편지함', 'send', ['G', 'T']],
      ['drafts', '임시보관함', 'draft', ['G', 'D']],
      ['all', '전체 메일', 'all', ['G', 'A']],
      ['junk', '스팸', 'spam'],
      ['trash', '휴지통', 'trash']
    ]
    const list: Command[] = [
      { id: 'compose', group: '작업', label: '새 메일 쓰기', icon: 'pencil', keys: ['C'], run: () => openCompose() },
      { id: 'archive', group: '작업', label: '보관', icon: 'archive', keys: ['E'], run: () => void act({ type: 'archive' }) },
      { id: 'trash', group: '작업', label: '삭제', icon: 'trash', keys: ['#'], run: () => void act({ type: 'trash' }) },
      { id: 'read', group: '작업', label: '읽음으로 표시', icon: 'markRead', keys: ['⇧', 'I'], run: () => void act({ type: 'read', value: true }, undefined, { quiet: true }) },
      { id: 'unread', group: '작업', label: '읽지 않음으로 표시', icon: 'markUnread', keys: ['⇧', 'U'], run: () => void act({ type: 'read', value: false }, undefined, { quiet: true }) },
      { id: 'sync', group: '작업', label: '지금 동기화', icon: 'refresh', run: () => void api.sync.now() },
      ...roles.map(([role, label, icon, keys]) => ({ id: `go-${role}`, group: '이동', label, icon, keys, hint: '이동', run: () => goRole(role) })),
      { id: 'unread-only', group: '보기', label: unreadOnly ? '모든 메일 보기' : '안 읽은 메일만 보기', icon: 'markUnread' as IconName, keys: ['G', 'U'], run: () => toggleUnreadOnly() },
      { id: 'pane', group: '보기', label: readingPane ? '읽기 창 끄기' : '읽기 창 켜기', icon: 'split' as IconName, run: () => setReadingPane(!readingPane) },
      {
        id: 'density',
        group: '보기',
        label: density === 'compact' ? '기본 밀도로 보기' : '컴팩트하게 보기',
        icon: 'menu' as IconName,
        run: () => setPref('density', density === 'compact' ? 'comfortable' : 'compact')
      },
      { id: 'settings', group: '앱', label: '설정', icon: 'settings', keys: ['⌘', ','], run: () => openSettings() },
      { id: 'add', group: '앱', label: '계정 추가', icon: 'plus', run: () => useStore.setState({ addAccountOpen: true }) }
    ]
    if (accounts.length > 1) list.push({ id: 'acc-all', group: '계정', label: '모든 계정', icon: 'all', run: () => setAccountFilter(null) })
    for (const a of accounts)
      list.push({ id: `acc-${a.id}`, group: '계정', label: a.email, mark: <AccountMark id={a.id} email={a.email} color={a.color} size={16} />, run: () => setAccountFilter(a.id) })
    for (const m of mailboxes.filter((x) => x.type === 'user')) {
      const acc = accounts.find((a) => a.id === m.accountId)
      list.push({
        id: `label-${m.id}`,
        group: '라벨',
        label: m.path,
        mark: <span className="mx-1 h-2 w-2 rounded-[3px]" style={{ background: m.colorBg ?? 'var(--ink-3)' }} />,
        hint: accounts.length > 1 ? acc?.email : undefined,
        run: () => goLabel(m.id, m.accountId)
      })
    }
    return list
  }, [accounts, mailboxes, readingPane, density, unreadOnly])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s ? commands.filter((c) => match(c, s)) : commands.filter((c) => c.group !== '라벨')
    if (!s) return base
    return [...base, { id: 'search', group: '검색', label: `"${q.trim()}" 메일 검색`, icon: 'search' as IconName, run: () => (setSearchText(q.trim()), runSearch(q.trim(), true)) }]
  }, [q, commands])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const run = (c: Command | undefined): void => {
    if (!c) return
    close()
    c.run()
  }

  let lastGroup = ''
  return (
    <div
      className={cx('fixed inset-0 z-[55] flex justify-center bg-black/20 pt-[14vh] dark:bg-black/40', closing ? 'animate-fade-out pointer-events-none' : 'animate-fade')}
      onMouseDown={close}
    >
      <div
        className={cx(closing ? 'animate-pop-out' : 'animate-pop', 'flex h-fit max-h-[min(460px,64vh)] w-[600px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-float')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={17} className="text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
                e.preventDefault()
                setIdx((i) => Math.min(filtered.length - 1, i + 1))
              } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') run(filtered[idx])
            }}
            placeholder="명령, 라벨, 계정을 찾거나 메일 검색"
            className="h-full flex-1 bg-transparent text-[15px] text-ink outline-none"
          />
          <kbd>esc</kbd>
        </div>
        <div ref={listRef} className="overflow-y-auto p-1.5">
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold tracking-wide text-ink-3">{c.group}</div>}
                <button
                  data-i={i}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => run(c)}
                  className={cx(
                    'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13.5px]',
                    i === idx ? 'bg-active text-ink' : 'text-ink-2'
                  )}
                >
                  <span className={cx('flex w-4 justify-center', i === idx ? 'text-accent' : 'text-ink-3')}>
                    {c.mark ?? (c.icon && <Icon name={c.icon} size={15} />)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && c.group === '라벨' && <span className="truncate text-[11.5px] text-ink-3">{c.hint}</span>}
                  {c.keys && (
                    <span className="flex gap-1">
                      {c.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  )}
                  {i === idx && !c.keys && <Icon name="enter" size={13} className="text-ink-3" />}
                </button>
              </div>
            )
          })}
          {!filtered.length && <div className="px-3 py-8 text-center text-[13px] text-ink-3">일치하는 항목이 없습니다</div>}
        </div>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-4 text-[11.5px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <kbd>↑</kbd>
            <kbd>↓</kbd> 이동
          </span>
          <span className="flex items-center gap-1.5">
            <kbd>↵</kbd> 실행
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd>⌘</kbd>
            <kbd>K</kbd> 열기/닫기
          </span>
        </div>
      </div>
    </div>
  )
}
