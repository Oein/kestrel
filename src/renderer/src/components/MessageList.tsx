import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { InboxCategory, Mailbox, ThreadRow, View } from '../../../shared/types'
import { dayGroup, listDate } from '../lib/format'
import { useLayout } from '../lib/layout'
import { setKeyboardNav, useAccountColor, useKeyboardNav, usePrefs } from '../lib/prefs'
import { checkRow, clickRow, consumeDragClick, startDrag, startDragFromBlank } from '../lib/selection'
import { act, api, goRole, loadMoreRows, runSearch, setReadingPane, setSearchText, toggleUnreadOnly, useStore } from '../store'
import { Icon, type IconName } from './Icon'
import { Checkbox, cx, IconButton, LabelChip } from './ui'

const CATEGORIES: { id: InboxCategory; label: string }[] = [
  { id: 'primary', label: '기본' },
  { id: 'promotions', label: '프로모션' },
  { id: 'social', label: '소셜' },
  { id: 'updates', label: '업데이트' }
]

const ROLE_TITLE: Record<string, string> = {
  inbox: '받은편지함',
  starred: '별표',
  sent: '보낸편지함',
  drafts: '임시보관함',
  all: '전체 메일',
  junk: '스팸',
  trash: '휴지통',
  archive: '보관함',
  important: '중요'
}

export function viewTitle(view: View, mailboxes: Mailbox[]): string {
  if (view.kind === 'role') return ROLE_TITLE[view.role] ?? view.role
  if (view.kind === 'label') return mailboxes.find((m) => m.id === view.mailboxId)?.name ?? '라벨'
  return '검색 결과'
}

type Item = { kind: 'header'; label: string; key: string } | { kind: 'row'; row: ThreadRow; index: number; key: number }

const HEADER_H = 30

function HoverTool({ icon, title, onClick, className }: { icon: IconName; title: string; onClick: () => void; className?: string }): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cx('flex h-6 w-6 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink', className)}
    >
      <Icon name={icon} size={14} />
    </button>
  )
}

const Row = memo(function Row(props: {
  row: ThreadRow
  index: number
  wide: boolean
  compact: boolean
  open: boolean
  cursor: boolean
  selected: boolean
  selecting: boolean
  accountColor: string | null
  labels: Mailbox[]
  fresh: boolean
}): React.JSX.Element {
  const { row, index, wide, compact, open, cursor, selected, selecting, accountColor, labels, fresh } = props
  const handlers = {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => startDrag(index, e, e.currentTarget.closest<HTMLElement>('[data-list-scroller]')),
    onClick: (e: React.MouseEvent) => {
      if (!consumeDragClick()) clickRow(index, e)
    }
  }
  const unread = row.unread
  const sender = row.participants || row.from.name || row.from.email || '(알 수 없음)'

  const gutter = (
    <div className="relative flex w-4 shrink-0 justify-center">
      <span className={cx('flex items-center justify-center', selecting || selected ? 'hidden' : 'group-hover:hidden')}>
        <span
          className={cx(
            'h-[7px] w-[7px] rounded-full bg-accent transition-[opacity,transform] duration-200 ease-out',
            unread ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          )}
        />
      </span>
      <span className={cx(selecting || selected ? 'flex' : 'hidden group-hover:flex')}>
        <Checkbox checked={selected} onChange={(e) => checkRow(index, e.shiftKey)} title="선택 (X) · ⇧클릭으로 범위 선택" />
      </span>
    </div>
  )

  const tools = (
    <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 translate-x-1 items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5 opacity-0 shadow-pop transition-[opacity,transform] duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100">
      <HoverTool icon="archive" title="보관 (E)" onClick={() => void act({ type: 'archive' }, [row.id])} />
      <HoverTool icon="trash" title="삭제 (#)" className="hover:!text-danger" onClick={() => void act({ type: 'trash' }, [row.id])} />
      <HoverTool
        icon={unread ? 'markRead' : 'markUnread'}
        title={unread ? '읽음으로 표시 (⇧I)' : '읽지 않음으로 표시 (⇧U)'}
        onClick={() => void act({ type: 'read', value: unread }, [row.id], { quiet: true })}
      />
      <HoverTool
        icon={row.starred ? 'starFilled' : 'star'}
        title="별표 (S)"
        className={row.starred ? '!text-star' : ''}
        onClick={() => void act({ type: 'star', value: !row.starred }, [row.id], { quiet: true })}
      />
    </div>
  )

  const meta = (
    <span className="flex shrink-0 items-center gap-1.5 text-ink-3">
      {row.starred && <Icon name="starFilled" size={12} className="animate-star text-star" />}
      {row.hasAttachments && <Icon name="attach" size={12} />}
      {accountColor && <span className="h-1.5 w-1.5 rounded-full" style={{ background: accountColor }} title="계정" />}
      <span className={cx('tnum text-[11.5px]', unread && 'font-medium text-ink-2')}>{listDate(row.date)}</span>
    </span>
  )

  const shell = cx(
    'group relative mx-2 flex h-[calc(100%-2px)] rounded-lg px-2 leading-[1.4]',
    fresh && 'animate-new-row',
    open ? 'bg-active' : selected ? 'bg-accent-soft' : 'hover:bg-hover',
    cursor && !open && 'shadow-[inset_0_0_0_1px_var(--line-strong)]'
  )

  if (wide) {
    return (
      <div data-row {...handlers} className={cx(shell, 'items-center gap-3 text-[13px]')}>
        {gutter}
        <span className={cx('w-[190px] shrink-0 truncate', unread ? 'font-semibold text-ink' : 'text-ink-2')}>
          {sender}
          {row.count > 1 && <span className="tnum ml-1.5 text-[11px] font-normal text-ink-3">{row.count}</span>}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cx('shrink-0 truncate', unread ? 'font-semibold text-ink' : 'text-ink')} style={{ maxWidth: '55%' }}>
            {row.subject || '(제목 없음)'}
          </span>
          <span className="min-w-0 truncate text-ink-3">{row.snippet}</span>
        </span>
        {labels.slice(0, 2).map((l) => (
          <LabelChip key={l.id} name={l.name} color={l.colorBg} />
        ))}
        {meta}
        {tools}
      </div>
    )
  }

  if (compact) {
    return (
      <div data-row {...handlers} className={cx(shell, 'gap-2 py-1.5')}>
        <div className="pt-[3px]">{gutter}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold text-ink' : 'text-ink-2')}>
              {sender}
              {row.count > 1 && <span className="tnum ml-1.5 text-[11px] font-normal text-ink-3">{row.count}</span>}
            </span>
            {meta}
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <span className={cx('shrink-0 truncate', unread ? 'font-medium text-ink' : 'text-ink')} style={{ maxWidth: '70%' }}>
              {row.subject || '(제목 없음)'}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-3">{row.snippet}</span>
          </div>
        </div>
        {tools}
      </div>
    )
  }

  return (
    <div data-row {...handlers} className={cx(shell, 'gap-2 py-2')}>
      <div className="pt-[5px]">{gutter}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cx('min-w-0 flex-1 truncate', unread ? 'font-semibold text-ink' : 'text-ink-2')}>
            {sender}
            {row.count > 1 && <span className="tnum ml-1.5 text-[11px] font-normal text-ink-3">{row.count}</span>}
          </span>
          {meta}
        </div>
        <div className={cx('truncate', unread ? 'font-medium text-ink' : 'text-ink')}>{row.subject || '(제목 없음)'}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{row.snippet}</span>
          {labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.colorBg} />
          ))}
        </div>
      </div>
      {tools}
    </div>
  )
})

export function MessageList(): React.JSX.Element {
  const rows = useStore((s) => s.rows)
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const selected = useStore((s) => s.selected)
  const openId = useStore((s) => s.openId)
  // one-line rows only when the list spans a wide area
  const wide = useLayout((s) => !s.split && s.mainWidth >= 760)
  const compact = usePrefs((s) => s.density) === 'compact'
  const keyboardNav = useKeyboardNav((s) => s.on)
  const accounts = useStore((s) => s.accounts)
  const mailboxes = useStore((s) => s.mailboxes)
  const listLoaded = useStore((s) => s.listLoaded)
  const loadingMore = useStore((s) => s.loadingMore)
  const hasMore = useStore((s) => s.hasMore)
  const parentRef = useRef<HTMLDivElement>(null)

  const unified = view.accountId === null && accounts.length > 1
  const colorOf = useAccountColor()
  const colors = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, colorOf(a)])), [accounts, colorOf])
  const mbById = useMemo(() => new Map(mailboxes.map((m) => [m.id, m])), [mailboxes])
  const showCategories =
    view.kind === 'role' && view.role === 'inbox' && accounts.some((a) => a.provider === 'gmail' && (!view.accountId || a.id === view.accountId))

  // highlight conversations that arrive while this view is open (new mail)
  // only mail newer than everything already shown counts (not rows that slide up or page in from below)
  const seen = useRef<{ key: string; newest: number }>({ key: '', newest: 0 })
  const vKey = JSON.stringify(view)
  const fresh = useMemo(() => {
    const s = seen.current
    if (s.key !== vKey || !s.newest) return new Set<number>()
    return new Set(rows.filter((r) => r.date > s.newest).map((r) => r.id))
  }, [rows, vKey])
  useEffect(() => {
    if (!listLoaded) return
    if (seen.current.key !== vKey) seen.current = { key: vKey, newest: 0 }
    for (const r of rows) if (r.date > seen.current.newest) seen.current.newest = r.date
  }, [rows, vKey, listLoaded])

  // rows interleaved with day headers ("오늘", "어제", ...)
  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    let last = ''
    rows.forEach((row, index) => {
      const g = dayGroup(row.date)
      if (g !== last) {
        out.push({ kind: 'header', label: g, key: `h:${g}` })
        last = g
      }
      out.push({ kind: 'row', row, index, key: row.id })
    })
    return out
  }, [rows])
  const itemIndexOfRow = useMemo(() => {
    const m: number[] = []
    items.forEach((it, i) => it.kind === 'row' && (m[it.index] = i))
    return m
  }, [items])

  const rowH = wide ? (compact ? 28 : 34) : compact ? 50 : 76
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]?.kind === 'header' ? (wide ? 26 : HEADER_H) : rowH),
    overscan: 14,
    getItemKey: (i) => items[i]?.key ?? i
  })

  useEffect(() => {
    virt.measure()
  }, [wide, compact, virt])

  useEffect(() => {
    const i = itemIndexOfRow[cursor]
    if (i !== undefined) virt.scrollToIndex(i, { align: 'auto' })
  }, [cursor]) // eslint-disable-line react-hooks/exhaustive-deps

  const virtual = virt.getVirtualItems()
  const lastItem = virtual[virtual.length - 1]
  useEffect(() => {
    if (lastItem && lastItem.index >= items.length - 15 && rows.length > 0) void loadMoreRows()
  }, [lastItem?.index, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const selecting = selected.size > 0

  return (
    <div data-region="list" className="flex h-full min-w-0 flex-col">
      <ListHeader />
      <SearchField />
      {showCategories && view.kind === 'role' && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative flex rounded-lg bg-hover p-0.5">
            <span
              className="absolute inset-y-0.5 left-0.5 rounded-md bg-surface shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_0.5px_var(--line-strong)] transition-transform duration-200"
              style={{
                width: `calc((100% - 4px) / ${CATEGORIES.length})`,
                transform: `translateX(${Math.max(0, CATEGORIES.findIndex((c) => c.id === (view.category ?? 'primary'))) * 100}%)`,
                transitionTimingFunction: 'var(--ease-out)'
              }}
            />
            {CATEGORIES.map((c) => {
              const active = (view.category ?? 'primary') === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => goRole('inbox', c.id)}
                  className={cx(
                    'relative h-[26px] flex-1 truncate rounded-md px-2 text-[12px] font-medium transition-colors duration-150',
                    active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
                  )}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div
        ref={parentRef}
        data-list-scroller
        onMouseDown={(e) => startDragFromBlank(e, e.currentTarget)}
        onMouseMove={() => keyboardNav && setKeyboardNav(false)} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.length === 0 ? (
          <EmptyList loaded={listLoaded} search={view.kind === 'search'} />
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virtual.map((v) => {
              const it = items[v.index]
              return (
                <div
                  key={v.key}
                  data-row-index={it.kind === 'row' ? it.index : undefined}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                    transition: 'transform 200ms var(--ease-out)'
                  }}
                >
                  {it.kind === 'header' ? (
                    <div className="flex h-full items-end px-5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3">{it.label}</div>
                  ) : (
                    <Row
                      row={it.row}
                      index={it.index}
                      wide={wide}
                      compact={compact}
                      open={openId === it.row.id}
                      cursor={keyboardNav && cursor === it.index}
                      selected={selected.has(it.row.id)}
                      selecting={selecting}
                      accountColor={unified ? colors[it.row.accountId] : null}
                      labels={it.row.labelIds.map((l) => mbById.get(l)).filter((m): m is Mailbox => !!m)}
                      fresh={fresh.has(it.row.id)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
        {(loadingMore || (hasMore && rows.length > 0)) && (
          <div className="flex justify-center py-3">{loadingMore && <Icon name="spinner" size={14} className="text-ink-3" />}</div>
        )}
      </div>
    </div>
  )
}

function SearchField(): React.JSX.Element {
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
    <div className="shrink-0 px-3 pb-2">
      <div className="flex h-8 items-center gap-2 rounded-lg border border-transparent bg-hover px-2.5 transition-colors focus-within:border-line-strong focus-within:bg-surface">
        <Icon name="search" size={14} className="text-ink-3" />
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
          placeholder={account ? `${account.email.split('@')[0]}에서 검색` : '검색'}
          title="from:, to:, subject:, is:unread, has:attachment 사용 가능"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        {searchText ? (
          <button onClick={() => setSearchText('')} className="text-ink-3 hover:text-ink">
            <Icon name="close" size={14} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>
    </div>
  )
}

function ListHeader(): React.JSX.Element {
  const selected = useStore((s) => s.selected)
  const rows = useStore((s) => s.rows)
  const view = useStore((s) => s.view)
  const mailboxes = useStore((s) => s.mailboxes)
  const readingPane = useStore((s) => s.readingPane)
  const statuses = useStore((s) => s.statuses)
  const syncing = Object.values(statuses).some((s) => s.state === 'syncing')
  const ids = [...selected]
  const inTrash = view.kind === 'role' && view.role === 'trash'
  const all = rows.length > 0 && selected.size === rows.length
  const unreadHere = useMemo(() => rows.filter((r) => r.unread).length, [rows])
  const unreadOnly = useStore((s) => s.unreadOnly)

  if (selected.size > 0) {
    return (
      <div className="drag animate-fade flex h-[52px] shrink-0 items-center gap-1 px-4">
        <Checkbox
          checked={all}
          indeterminate={!all}
          onChange={() => useStore.setState({ selected: all ? new Set() : new Set(rows.map((r) => r.id)) })}
          className="no-drag mr-2"
        />
        <span className="tnum mr-auto text-[13px] font-semibold">{selected.size}개 선택</span>
        {inTrash ? (
          <IconButton icon="restore" title="복원" onClick={() => void act({ type: 'untrash' }, ids)} />
        ) : (
          <>
            <IconButton icon="archive" title="보관 (E)" onClick={() => void act({ type: 'archive' }, ids)} />
            <IconButton icon="trash" title="삭제 (#)" danger onClick={() => void act({ type: 'trash' }, ids)} />
          </>
        )}
        <IconButton icon="markRead" title="읽음 (⇧I)" onClick={() => void act({ type: 'read', value: true }, ids, { quiet: true })} />
        <IconButton icon="markUnread" title="읽지 않음 (⇧U)" onClick={() => void act({ type: 'read', value: false }, ids, { quiet: true })} />
        <IconButton icon="close" title="선택 해제 (Esc)" onClick={() => useStore.setState({ selected: new Set() })} />
      </div>
    )
  }

  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-1 pl-5 pr-3">
      <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{viewTitle(view, mailboxes)}</h1>
      {unreadHere > 0 && view.kind !== 'search' && (
        <span className="tnum ml-1.5 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold leading-[18px] text-accent">{unreadHere}</span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => toggleUnreadOnly()}
        title="안 읽은 메일만 보기 (G U)"
        className={cx(
          'no-drag mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors',
          unreadOnly ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-hover hover:text-ink'
        )}
      >
        <span className={cx('h-[7px] w-[7px] rounded-full', unreadOnly ? 'bg-accent' : 'border-[1.5px] border-current')} />
        안 읽음
      </button>
      <IconButton
        icon={syncing ? 'spinner' : 'refresh'}
        title="지금 동기화"
        onClick={() => void api.sync.now()}
      />
      <IconButton
        icon="split"
        title={readingPane ? '읽기 창 끄기' : '읽기 창 켜기'}
        active={readingPane}
        onClick={() => setReadingPane(!readingPane)}
      />
    </div>
  )
}

function EmptyList({ loaded, search }: { loaded: boolean; search: boolean }): React.JSX.Element {
  const statuses = useStore((s) => s.statuses)
  const unreadOnly = useStore((s) => s.unreadOnly)
  const syncing = Object.values(statuses).some((s) => s.state === 'syncing')
  if (!loaded) return <div />
  if (unreadOnly && !search)
    return (
      <div className="animate-slide-up flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name="check" size={20} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium text-ink">안 읽은 메일이 없습니다</div>
          <button className="mt-1 text-[12px] font-medium text-ink-3 hover:text-ink" onClick={() => toggleUnreadOnly(false)}>
            모든 메일 보기
          </button>
        </div>
      </div>
    )
  return (
    <div className="animate-slide-up flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-hover text-ink-3">
        <Icon name={search ? 'search' : syncing ? 'spinner' : 'check'} size={20} />
      </span>
      <div>
        <div className="text-[13.5px] font-medium text-ink">
          {search ? '검색 결과가 없습니다' : syncing ? '메일을 가져오는 중' : '모두 처리했습니다'}
        </div>
        <div className="mt-1 text-[12px] text-ink-3">
          {search ? '다른 검색어나 from:, has:attachment 를 사용해 보세요' : syncing ? '잠시만 기다려 주세요' : '새 메일이 오면 바로 여기에 표시됩니다'}
        </div>
      </div>
    </div>
  )
}
