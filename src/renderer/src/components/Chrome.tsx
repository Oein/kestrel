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
  useStore
} from '../store'
import { Icon } from './Icon'

export function TopBar(): React.JSX.Element {
  const searchText = useStore((s) => s.searchText)
  const accounts = useStore((s) => s.accounts)
  const filter = useStore((s) => s.accountFilter)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focus = (): void => ref.current?.focus()
    window.addEventListener('mailbird:focus-search', focus)
    return () => window.removeEventListener('mailbird:focus-search', focus)
  }, [])
  const account = accounts.find((a) => a.id === filter)
  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 pr-4">
      <div className="no-drag flex h-11 max-w-[720px] flex-1 items-center gap-2 rounded-full bg-[#e9eef6] px-4 focus-within:bg-white focus-within:shadow-md dark:bg-[#22262d] dark:focus-within:bg-[#2a2e36]">
        <Icon name="search" className="opacity-60" />
        <input
          ref={ref}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') runSearch(searchText, true)
            if (e.key === 'Escape') {
              setSearchText('')
              ref.current?.blur()
            }
            if (e.key === 'ArrowDown') ref.current?.blur()
          }}
          placeholder={account ? `${account.email}에서 검색` : '메일 검색 (from:, to:, subject:, is:unread, has:attachment)'}
          className="h-full flex-1 bg-transparent outline-none placeholder:opacity-60"
        />
        {searchText && (
          <button onClick={() => setSearchText('')} className="opacity-60 hover:opacity-100">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      <div className="flex-1" />
      <button
        onClick={() => useStore.setState({ paletteOpen: true })}
        className="no-drag flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        title="명령 팔레트"
      >
        <kbd>⌘K</kbd>
      </button>
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex min-w-[300px] max-w-[520px] items-center gap-4 rounded-md px-4 py-3 text-[14px] shadow-lg ${
            t.kind === 'error' ? 'bg-[#b3261e] text-white' : 'bg-[#303030] text-[#f2f2f2] dark:bg-[#e3e3e3] dark:text-[#1f1f1f]'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              className="font-medium text-[#a8c7fa] hover:underline dark:text-[#0b57d0]"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} className="opacity-70 hover:opacity-100">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const accounts = useStore((s) => s.accounts)
  const mailboxes = useStore((s) => s.mailboxes)
  const readingPane = useStore((s) => s.readingPane)
  const close = (): void => useStore.setState({ paletteOpen: false })

  const commands = useMemo<Command[]>(() => {
    const roles: [MailboxRole, string, string][] = [
      ['inbox', '받은편지함으로 이동', 'g i'],
      ['starred', '별표편지함으로 이동', 'g s'],
      ['sent', '보낸편지함으로 이동', 'g t'],
      ['drafts', '임시보관함으로 이동', 'g d'],
      ['all', '전체보관함으로 이동', 'g a'],
      ['junk', '스팸으로 이동', ''],
      ['trash', '휴지통으로 이동', '']
    ]
    const list: Command[] = [
      { id: 'compose', label: '편지쓰기', hint: 'c', run: () => openCompose() },
      ...roles.map(([role, label, hint]) => ({ id: `go-${role}`, label, hint, run: () => goRole(role) })),
      { id: 'archive', label: '선택한 대화 보관', hint: 'e', run: () => void act({ type: 'archive' }) },
      { id: 'trash', label: '선택한 대화 삭제', hint: '#', run: () => void act({ type: 'trash' }) },
      { id: 'read', label: '읽음으로 표시', hint: 'Shift+I', run: () => void act({ type: 'read', value: true }, undefined, { quiet: true }) },
      { id: 'unread', label: '읽지 않음으로 표시', hint: 'Shift+U', run: () => void act({ type: 'read', value: false }, undefined, { quiet: true }) },
      { id: 'pane', label: readingPane ? '읽기 창 끄기' : '읽기 창 켜기', run: () => setReadingPane(!readingPane) },
      { id: 'sync', label: '지금 동기화', run: () => void api.sync.now() },
      { id: 'add', label: '계정 추가', run: () => useStore.setState({ addAccountOpen: true }) },
      { id: 'settings', label: '설정 열기', run: () => useStore.setState({ settingsOpen: true }) },
      { id: 'oauth', label: 'OAuth 클라이언트 관리', run: () => useStore.setState({ settingsOpen: true }) }
    ]
    if (accounts.length > 1) list.push({ id: 'acc-all', label: '계정 전환: 모든 계정', run: () => setAccountFilter(null) })
    for (const a of accounts) list.push({ id: `acc-${a.id}`, label: `계정 전환: ${a.email}`, run: () => setAccountFilter(a.id) })
    for (const m of mailboxes.filter((x) => x.type === 'user')) {
      const acc = accounts.find((a) => a.id === m.accountId)
      list.push({
        id: `label-${m.id}`,
        label: `라벨: ${m.path}`,
        hint: accounts.length > 1 ? acc?.email : undefined,
        run: () => goLabel(m.id, m.accountId)
      })
    }
    return list
  }, [accounts, mailboxes, readingPane])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s ? commands.filter((c) => c.label.toLowerCase().includes(s) || c.hint?.toLowerCase().includes(s)) : commands
    return s ? [...base, { id: 'search', label: `"${q.trim()}" 검색`, run: () => (setSearchText(q.trim()), runSearch(q.trim(), true)) }] : base
  }, [q, commands])

  useEffect(() => setIdx(0), [q])

  const run = (c: Command | undefined): void => {
    if (!c) return
    close()
    c.run()
  }

  return (
    <div className="fixed inset-0 z-[55] flex justify-center bg-black/30 pt-[12vh]" onMouseDown={close}>
      <div
        className="flex h-fit max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-[#1f2329]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(filtered.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') run(filtered[idx])
          }}
          placeholder="명령 입력 또는 검색..."
          className="h-14 border-b border-black/10 bg-transparent px-5 text-[15px] outline-none dark:border-white/10"
        />
        <div className="overflow-y-auto py-1">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
              className={`flex w-full items-center gap-3 px-5 py-2 text-left text-[14px] ${i === idx ? 'bg-[#0b57d0]/10' : ''}`}
            >
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint && <span className="shrink-0 text-[12px] opacity-50">{c.hint}</span>}
            </button>
          ))}
          {!filtered.length && <div className="px-5 py-4 text-[13px] opacity-50">결과 없음</div>}
        </div>
      </div>
    </div>
  )
}
