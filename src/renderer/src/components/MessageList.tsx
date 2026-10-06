import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { InboxCategory, Mailbox, ThreadRow } from '../../../shared/types'
import { fileSize, listDate } from '../lib/format'
import { act, api, goRole, loadMoreRows, openThread, setReadingPane, toggleSelect, useStore } from '../store'
import { Icon } from './Icon'

const CATEGORIES: { id: InboxCategory; label: string; icon: 'inbox' | 'label' | 'person' | 'warning' }[] = [
  { id: 'primary', label: '기본', icon: 'inbox' },
  { id: 'promotions', label: '프로모션', icon: 'label' },
  { id: 'social', label: '소셜', icon: 'person' },
  { id: 'updates', label: '업데이트', icon: 'warning' }
]

function LabelChip({ mb }: { mb: Mailbox }): React.JSX.Element {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-px text-[11px] leading-4"
      style={{
        background: mb.colorBg ?? 'rgba(127,127,127,.18)',
        color: mb.colorText ?? undefined
      }}
    >
      {mb.name}
    </span>
  )
}

const Row = memo(function Row(props: {
  row: ThreadRow
  compact: boolean
  active: boolean
  cursor: boolean
  selected: boolean
  accountColor: string | null
  labels: Mailbox[]
  onOpen: (id: number) => void
}): React.JSX.Element {
  const { row, compact, active, cursor, selected, accountColor, labels, onOpen } = props
  const unread = row.unread
  const bg = active
    ? 'bg-[#d3e3fd] dark:bg-[#0b3a63]'
    : selected
      ? 'bg-[#c2dbff] dark:bg-[#123a5c]'
      : unread
        ? 'bg-white dark:bg-[#1b1e24]'
        : 'bg-[#f2f6fc] dark:bg-[#15171c]'
  const check = (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => toggleSelect(row.id)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 accent-[#0b57d0]"
    />
  )
  const star = (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void act({ type: 'star', value: !row.starred }, [row.id], { quiet: true })
      }}
      className={row.starred ? 'text-amber-400' : 'text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60'}
      title={row.starred ? '별표 해제 (s)' : '별표 (s)'}
    >
      <Icon name={row.starred ? 'starFilled' : 'star'} size={18} />
    </button>
  )
  const sender = (
    <span className={`truncate ${unread ? 'font-bold' : ''}`}>
      {row.participants || row.from.name || row.from.email || '(알 수 없음)'}
      {row.count > 1 && <span className="ml-1 text-xs font-normal opacity-60">{row.count}</span>}
    </span>
  )
  const attachments = row.attachments.length > 0 && (
    <div className="flex gap-1.5 overflow-hidden">
      {row.attachments.slice(0, 3).map((a) => (
        <span
          key={a.id}
          className="flex max-w-[180px] items-center gap-1 rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/15"
          title={`${a.filename} ${fileSize(a.size)}`}
        >
          <Icon name="attach" size={13} className="opacity-60" />
          <span className="truncate">{a.filename}</span>
        </span>
      ))}
      {row.attachments.length > 3 && <span className="text-xs opacity-60">+{row.attachments.length - 3}</span>}
    </div>
  )
  const cursorBar = cursor && <span className="absolute inset-y-0 left-0 w-[3px] bg-[#0b57d0]" />
  const dot = accountColor && (
    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accountColor }} title="계정" />
  )

  if (compact) {
    return (
      <div
        onClick={() => onOpen(row.id)}
        className={`relative flex h-full gap-3 border-b border-black/5 px-3 py-2.5 dark:border-white/5 ${bg}`}
      >
        {cursorBar}
        <div className="flex flex-col items-center gap-2 pt-0.5">
          {check}
          {star}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {dot}
            <span className="flex min-w-0 flex-1">{sender}</span>
            {row.hasAttachments && <Icon name="attach" size={14} className="opacity-50" />}
            <span className={`shrink-0 text-xs ${unread ? 'font-bold' : 'opacity-60'}`}>{listDate(row.date)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={`truncate ${unread ? 'font-semibold' : ''}`}>{row.subject || '(제목 없음)'}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {labels.slice(0, 2).map((l) => (
              <LabelChip key={l.id} mb={l} />
            ))}
            <span className="truncate text-[13px] opacity-60">{row.snippet}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => onOpen(row.id)}
      className={`group relative flex h-full flex-col justify-center border-b border-black/5 px-3 hover:z-10 hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_0_rgba(60,64,67,.3)] dark:border-white/5 ${bg}`}
    >
      {cursorBar}
      <div className="flex h-10 items-center gap-3">
        {check}
        {star}
        {dot}
        <div className="flex w-[200px] shrink-0 min-w-0">{sender}</div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} mb={l} />
          ))}
          <span className={`shrink-0 truncate ${unread ? 'font-bold' : ''}`} style={{ maxWidth: '60%' }}>
            {row.subject || '(제목 없음)'}
          </span>
          <span className="truncate opacity-60">&nbsp;-&nbsp;{row.snippet}</span>
        </div>
        <div className="flex w-[84px] shrink-0 justify-end">
          <span className={`text-xs group-hover:hidden ${unread ? 'font-bold' : 'opacity-70'}`}>{listDate(row.date)}</span>
          <div className="hidden items-center gap-0.5 group-hover:flex">
            <HoverBtn icon="archive" title="보관 (e)" onClick={() => act({ type: 'archive' }, [row.id])} />
            <HoverBtn icon="trash" title="삭제 (#)" onClick={() => act({ type: 'trash' }, [row.id])} />
            <HoverBtn
              icon={unread ? 'markRead' : 'markUnread'}
              title={unread ? '읽음으로 표시' : '읽지 않음으로 표시'}
              onClick={() => act({ type: 'read', value: unread }, [row.id], { quiet: true })}
            />
          </div>
        </div>
      </div>
      {attachments && <div className="-mt-1 pb-2 pl-[296px]">{attachments}</div>}
    </div>
  )
})

function HoverBtn({ icon, title, onClick }: { icon: 'archive' | 'trash' | 'markRead' | 'markUnread'; title: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded-full p-1.5 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

export function MessageList(): React.JSX.Element {
  const rows = useStore((s) => s.rows)
  const view = useStore((s) => s.view)
  const cursor = useStore((s) => s.cursor)
  const selected = useStore((s) => s.selected)
  const openId = useStore((s) => s.openId)
  const compact = useStore((s) => s.readingPane)
  const accounts = useStore((s) => s.accounts)
  const mailboxes = useStore((s) => s.mailboxes)
  const listLoaded = useStore((s) => s.listLoaded)
  const loadingMore = useStore((s) => s.loadingMore)
  const hasMore = useStore((s) => s.hasMore)
  const parentRef = useRef<HTMLDivElement>(null)

  const unified = view.accountId === null && accounts.length > 1
  const colors = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.color])), [accounts])
  const mbById = useMemo(() => new Map(mailboxes.map((m) => [m.id, m])), [mailboxes])
  const showCategories =
    view.kind === 'role' &&
    view.role === 'inbox' &&
    accounts.some((a) => a.provider === 'gmail' && (!view.accountId || a.id === view.accountId))

  const sizeOf = (r: ThreadRow | undefined): number => (compact ? 92 : r && r.attachments.length ? 72 : 40)
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => sizeOf(rows[i]),
    overscan: 12,
    getItemKey: (i) => rows[i]?.id ?? i
  })

  useEffect(() => {
    virt.measure()
  }, [compact, virt])

  useEffect(() => {
    if (rows.length) virt.scrollToIndex(cursor, { align: 'auto' })
  }, [cursor]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = virt.getVirtualItems()
  const last = items[items.length - 1]
  useEffect(() => {
    if (last && last.index >= rows.length - 15 && rows.length > 0) void loadMoreRows()
  }, [last?.index, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar allSelected={allSelected} />
      {showCategories && view.kind === 'role' && (
        <div className="flex shrink-0 border-b border-black/5 dark:border-white/5">
          {CATEGORIES.map((c) => {
            const active = (view.category ?? 'primary') === c.id
            return (
              <button
                key={c.id}
                onClick={() => goRole('inbox', c.id)}
                className={`relative flex h-11 flex-1 items-center gap-3 px-4 text-[13px] ${
                  active ? 'font-semibold text-[#0b57d0] dark:text-[#a8c7fa]' : 'opacity-75 hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <Icon name={c.icon} size={18} />
                {!compact && c.label}
                {compact && <span className="truncate">{c.label}</span>}
                {active && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-[#0b57d0] dark:bg-[#a8c7fa]" />}
              </button>
            )
          })}
        </div>
      )}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyList loaded={listLoaded} search={view.kind === 'search'} />
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {items.map((it) => {
              const r = rows[it.index]
              return (
                <div
                  key={it.key}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: it.size, transform: `translateY(${it.start}px)` }}
                >
                  <Row
                    row={r}
                    compact={compact}
                    active={openId === r.id}
                    cursor={cursor === it.index}
                    selected={selected.has(r.id)}
                    accountColor={unified ? colors[r.accountId] : null}
                    labels={r.labelIds.map((l) => mbById.get(l)).filter((m): m is Mailbox => !!m)}
                    onOpen={openThread}
                  />
                </div>
              )
            })}
          </div>
        )}
        {(loadingMore || (hasMore && rows.length > 0)) && (
          <div className="py-3 text-center text-xs opacity-50">{loadingMore ? '더 불러오는 중...' : ''}</div>
        )}
      </div>
    </div>
  )
}

function EmptyList({ loaded, search }: { loaded: boolean; search: boolean }): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const statuses = useStore((s) => s.statuses)
  const syncing = Object.values(statuses).some((s) => s.state === 'syncing')
  if (!loaded) return <div />
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center opacity-60">
      <Icon name={search ? 'search' : 'inbox'} size={40} />
      <div>
        {accounts.length === 0
          ? '계정을 추가하세요'
          : search
            ? '검색 결과가 없습니다'
            : syncing
              ? '메일을 동기화하는 중...'
              : '메일이 없습니다'}
      </div>
    </div>
  )
}

function Toolbar({ allSelected }: { allSelected: boolean }): React.JSX.Element {
  const selected = useStore((s) => s.selected)
  const rows = useStore((s) => s.rows)
  const view = useStore((s) => s.view)
  const readingPane = useStore((s) => s.readingPane)
  const has = selected.size > 0
  const ids = [...selected]
  const inTrash = view.kind === 'role' && view.role === 'trash'
  const btn = 'rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-3">
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = has && !allSelected
        }}
        onChange={() => useStore.setState({ selected: allSelected ? new Set() : new Set(rows.map((r) => r.id)) })}
        className="mx-2 h-4 w-4 accent-[#0b57d0]"
        title="선택 (x)"
      />
      {has ? (
        <>
          {!inTrash && (
            <button className={btn} title="보관 (e)" onClick={() => act({ type: 'archive' }, ids)}>
              <Icon name="archive" />
            </button>
          )}
          {inTrash ? (
            <button className={btn} title="휴지통에서 복원" onClick={() => act({ type: 'untrash' }, ids)}>
              <Icon name="restore" />
            </button>
          ) : (
            <button className={btn} title="삭제 (#)" onClick={() => act({ type: 'trash' }, ids)}>
              <Icon name="trash" />
            </button>
          )}
          <button className={btn} title="읽음으로 표시 (Shift+I)" onClick={() => act({ type: 'read', value: true }, ids, { quiet: true })}>
            <Icon name="markRead" />
          </button>
          <button className={btn} title="읽지 않음으로 표시 (Shift+U)" onClick={() => act({ type: 'read', value: false }, ids, { quiet: true })}>
            <Icon name="markUnread" />
          </button>
          <span className="ml-2 text-xs opacity-60">{selected.size}개 선택됨</span>
        </>
      ) : (
        <button className={btn} title="새로고침" onClick={() => void api.sync.now()}>
          <Icon name="refresh" />
        </button>
      )}
      <div className="flex-1" />
      <span className="mr-2 text-xs opacity-50">{rows.length > 0 ? `${rows.length.toLocaleString()}개 대화` : ''}</span>
      <button
        className={`${btn} ${readingPane ? 'text-[#0b57d0] opacity-100 dark:text-[#a8c7fa]' : ''}`}
        title="읽기 창 전환"
        onClick={() => setReadingPane(!readingPane)}
      >
        <Icon name="split" />
      </button>
    </div>
  )
}
