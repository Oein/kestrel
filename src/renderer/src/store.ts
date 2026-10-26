import { create } from 'zustand'
import type {
  Account,
  DownloadProgress,
  Draft,
  InboxCategory,
  MailAction,
  Mailbox,
  MailboxRole,
  MessageBody,
  MessageMeta,
  SyncStatus,
  ThreadRow,
  View
} from '../../shared/types'

export const api = window.api

const PAGE = 150

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  message: string
  action?: { label: string; run: () => void }
  ttl: number
  /** download snackbar: stays up (no ttl) while active */
  progress?: { loaded: number; total: number; rate: number }
}

export interface ComposeState {
  key: number
  draft: Draft
  minimized: boolean
  title: string
}

export interface State {
  ready: boolean
  accounts: Account[]
  mailboxes: Mailbox[]
  statuses: Record<string, SyncStatus>
  accountFilter: string | null
  view: View
  rows: ThreadRow[]
  hasMore: boolean
  listLoaded: boolean
  loadingMore: boolean
  cursor: number
  selected: Set<number>
  openId: number | null
  readingPane: boolean
  composes: ComposeState[]
  toasts: Toast[]
  paletteOpen: boolean
  addAccountOpen: boolean
  settingsOpen: boolean
  /** tab to show when settings opens (e.g. 'general', 'rules'); set by ⌘, / the tray */
  settingsTab: string | null
  searchText: string
  /** "안 읽은 메일만" filter; sticks while moving between folders */
  unreadOnly: boolean
}

const initialView: View = { kind: 'role', role: 'inbox', accountId: null, category: 'primary' }

const loadPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(`kestrel.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
const savePref = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(`kestrel.${key}`, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export const useStore = create<State>(() => ({
  ready: false,
  accounts: [],
  mailboxes: [],
  statuses: {},
  accountFilter: null,
  view: initialView,
  rows: [],
  hasMore: false,
  listLoaded: false,
  loadingMore: false,
  cursor: 0,
  selected: new Set(),
  openId: null,
  readingPane: loadPref('readingPane', true),
  composes: [],
  toasts: [],
  paletteOpen: false,
  addAccountOpen: false,
  settingsOpen: false,
  settingsTab: null,
  searchText: '',
  unreadOnly: loadPref('unreadOnly', false)
}))

const set = useStore.setState
const get = useStore.getState

export const viewKey = (v: View): string => JSON.stringify(v)

// ---------- list cache (instant view switching) ----------
const listCache = new Map<string, { rows: ThreadRow[]; hasMore: boolean }>()
let listSeq = 0

export async function loadList(opts: { keepCount?: boolean } = {}): Promise<void> {
  const { view, rows } = get()
  const key = viewKey(view)
  const seq = ++listSeq
  const limit = opts.keepCount ? Math.max(PAGE, rows.length) : PAGE
  const res = await api.messages.list(view, 0, limit)
  if (seq !== listSeq || viewKey(get().view) !== key) return
  listCache.set(key, res)
  const s = get()
  const cursor = Math.min(s.cursor, Math.max(0, res.rows.length - 1))
  const ids = new Set(res.rows.map((r) => r.id))
  const selected = new Set([...s.selected].filter((id) => ids.has(id)))
  set({ rows: res.rows, hasMore: res.hasMore, listLoaded: true, cursor, selected })
  // prefetch bodies of the top messages
  void api.messages.prefetch(res.rows.slice(0, 20).map((r) => r.id))
}

export async function loadMoreRows(): Promise<void> {
  const s = get()
  if (s.loadingMore) return
  set({ loadingMore: true })
  const key = viewKey(s.view)
  try {
    if (s.hasMore) {
      const res = await api.messages.list(s.view, s.rows.length, PAGE)
      if (viewKey(get().view) !== key) return
      const seen = new Set(get().rows.map((r) => r.id))
      set({ rows: [...get().rows, ...res.rows.filter((r) => !seen.has(r.id))], hasMore: res.hasMore })
    } else if (s.view.kind !== 'search') {
      // ask the server for older mail; the mail:changed event reloads the list
      const n = await api.messages.loadMore(s.view)
      if (n > 0 && viewKey(get().view) === key) await loadList({ keepCount: true }).then(() => loadMoreRowsIfMore())
    }
  } catch (e) {
    toast('error', (e as Error).message)
  } finally {
    set({ loadingMore: false })
  }
}

async function loadMoreRowsIfMore(): Promise<void> {
  const s = get()
  if (!s.hasMore) return
  const res = await api.messages.list(s.view, s.rows.length, PAGE)
  const seen = new Set(get().rows.map((r) => r.id))
  set({ rows: [...get().rows, ...res.rows.filter((r) => !seen.has(r.id))], hasMore: res.hasMore })
}

export function setView(view: View): void {
  view = { ...view, unreadOnly: get().unreadOnly || undefined }
  const key = viewKey(view)
  const cached = listCache.get(key)
  set({
    view,
    rows: cached?.rows ?? [],
    hasMore: cached?.hasMore ?? false,
    listLoaded: !!cached,
    cursor: 0,
    selected: new Set(),
    openId: null
  })
  void loadList()
}

export function goRole(role: MailboxRole, category?: InboxCategory): void {
  const accountId = get().accountFilter
  set({ searchText: '' })
  setView({ kind: 'role', role, accountId, category: role === 'inbox' ? (category ?? 'primary') : undefined })
}

export function goLabel(mailboxId: string, accountId: string): void {
  set({ searchText: '' })
  setView({ kind: 'label', mailboxId, accountId })
}

export function setAccountFilter(accountId: string | null): void {
  set({ accountFilter: accountId })
  const v = get().view
  if (v.kind === 'label') setView({ kind: 'role', role: 'inbox', accountId, category: 'primary' })
  else setView({ ...v, accountId } as View)
}

export function toggleUnreadOnly(on = !get().unreadOnly): void {
  savePref('unreadOnly', on)
  set({ unreadOnly: on })
  setView(get().view)
}

export function setReadingPane(on: boolean): void {
  savePref('readingPane', on)
  set({ readingPane: on })
}

// ---------- search ----------
let searchTimer: ReturnType<typeof setTimeout> | null = null
let remoteTimer: ReturnType<typeof setTimeout> | null = null

export function setSearchText(text: string): void {
  set({ searchText: text })
  if (searchTimer) clearTimeout(searchTimer)
  if (remoteTimer) clearTimeout(remoteTimer)
  if (!text.trim()) {
    if (get().view.kind === 'search') goRole('inbox')
    return
  }
  searchTimer = setTimeout(() => runSearch(text, false), 120)
  remoteTimer = setTimeout(() => runSearch(text, true), 700)
}

export function runSearch(text: string, remote: boolean): void {
  const q = text.trim()
  if (!q) return
  const accountId = get().accountFilter
  const cur = get().view
  if (!remote) {
    if (cur.kind === 'search' && cur.query === q) return
    setView({ kind: 'search', query: q, accountId })
    return
  }
  if (searchTimer) clearTimeout(searchTimer)
  if (remoteTimer) clearTimeout(remoteTimer)
  void api.search.remote(q, accountId).then((token) => {
    const v = get().view
    if (v.kind === 'search' && v.query === q) {
      set({ view: { ...v, token } })
      // local results are already visible; server hits are merged on search:updated
    } else {
      setView({ kind: 'search', query: q, accountId, token })
    }
  })
}

// ---------- toasts ----------
let toastSeq = 0
export function toast(kind: Toast['kind'], message: string, action?: Toast['action'], ttl = 6000): number {
  const id = ++toastSeq
  set({ toasts: [...get().toasts.slice(-3), { id, kind, message, action, ttl }] })
  setTimeout(() => dismissToast(id), ttl)
  return id
}
export function dismissToast(id: number): void {
  set({ toasts: get().toasts.filter((t) => t.id !== id) })
}

/** download id → toast id */
const downloadToasts = new Map<string, number>()
function onDownload(d: DownloadProgress): void {
  const tid = downloadToasts.get(d.id)
  if (d.state === 'active') {
    const progress = { loaded: d.loaded, total: d.total, rate: d.rate }
    const existing = get().toasts.find((t) => t.id === tid)
    if (existing) {
      set({ toasts: get().toasts.map((t) => (t.id === tid ? { ...t, progress } : t)) })
    } else if (tid === undefined) {
      // dismissed toasts stay mapped so later events don't bring them back
      const id = ++toastSeq
      downloadToasts.set(d.id, id)
      set({ toasts: [...get().toasts.slice(-3), { id, kind: 'info', message: d.filename, ttl: Infinity, progress }] })
    }
    return
  }
  downloadToasts.delete(d.id)
  if (tid !== undefined) dismissToast(tid)
  // failures surface through the rejected IPC call
  if (d.state === 'done' && d.kind === 'save') toast('success', `첨부파일을 저장했습니다 — ${d.filename}`)
}

// ---------- bodies cache ----------
const bodies = new Map<number, MessageBody>()
const bodyListeners = new Set<() => void>()
export function cachedBody(id: number): MessageBody | undefined {
  return bodies.get(id)
}
export async function fetchBody(id: number): Promise<MessageBody> {
  const c = bodies.get(id)
  if (c) return c
  const b = await api.messages.body(id)
  bodies.set(id, b)
  bodyListeners.forEach((l) => l())
  return b
}
export function onBodies(cb: () => void): () => void {
  bodyListeners.add(cb)
  return () => bodyListeners.delete(cb)
}

// ---------- optimistic actions ----------
function willDisappear(view: View, action: MailAction): boolean {
  switch (action.type) {
    case 'archive':
      return view.kind === 'role' && view.role === 'inbox'
    case 'trash':
      return !(view.kind === 'role' && view.role === 'trash')
    case 'untrash':
    case 'moveToInbox':
      return view.kind === 'role' && (view.role === 'trash' || view.role === 'junk')
    case 'move':
      return true
    case 'label':
      return !action.value && view.kind === 'label' && view.mailboxId === action.mailboxId
    case 'star':
      return !action.value && view.kind === 'role' && view.role === 'starred'
    default:
      return false
  }
}

function patchRow(r: ThreadRow, action: MailAction): ThreadRow {
  switch (action.type) {
    case 'read':
      return { ...r, unread: !action.value }
    case 'star':
      return { ...r, starred: action.value }
    case 'label':
      return {
        ...r,
        labelIds: action.value ? [...new Set([...r.labelIds, action.mailboxId])] : r.labelIds.filter((l) => l !== action.mailboxId)
      }
    default:
      return r
  }
}

const ACTION_LABEL: Partial<Record<MailAction['type'], string>> = {
  archive: '보관처리됨',
  trash: '휴지통으로 이동됨',
  untrash: '휴지통에서 복원됨',
  moveToInbox: '받은편지함으로 이동됨',
  move: '이동됨'
}

/** Targets: explicit ids, else selection, else the open conversation, else the cursor row. */
export function currentTargets(): number[] {
  const s = get()
  if (s.selected.size) return [...s.selected]
  if (s.openId !== null) return [s.openId]
  const r = s.rows[s.cursor]
  return r ? [r.id] : []
}

export async function act(action: MailAction, ids: number[] = currentTargets(), opts: { quiet?: boolean } = {}): Promise<void> {
  if (!ids.length) return
  const s = get()
  const idSet = new Set(ids)
  // reading a mail in the "안 읽음" view drops it from the list, but the open mail stays open
  const readInUnreadView = !!s.view.unreadOnly && action.type === 'read' && action.value
  const disappears = willDisappear(s.view, action) || readInUnreadView
  const undoable = !!ACTION_LABEL[action.type] && !opts.quiet
  if (disappears) {
    const firstIdx = s.rows.findIndex((r) => idSet.has(r.id))
    const rows = s.rows.filter((r) => !idSet.has(r.id))
    let openId = s.openId
    let cursor = Math.min(firstIdx >= 0 ? firstIdx : s.cursor, Math.max(0, rows.length - 1))
    // the open mail left the list: keep the cursor just above its old slot so J opens the next one
    if (readInUnreadView) cursor = Math.max(0, cursor - 1)
    if (openId !== null && idSet.has(openId) && !readInUnreadView) {
      // reading pane: open the next conversation; full view: back to the list
      openId = s.readingPane && rows[cursor] ? rows[cursor].id : null
    }
    if (rows.length === 0) cursor = 0
    set({ rows, selected: new Set(), openId, cursor })
  } else {
    set({ rows: s.rows.map((r) => (idSet.has(r.id) ? patchRow(r, action) : r)) })
  }
  try {
    const { opId } = await api.messages.act({
      action,
      messageIds: ids,
      expandThreads: true,
      delayMs: undoable ? 5000 : 0
    })
    if (undoable) {
      const n = ids.length
      toast('info', `${n > 1 ? `대화 ${n}개 ` : '대화가 '}${ACTION_LABEL[action.type]}`, {
        label: '실행취소',
        run: () => void api.messages.undo(opId)
      })
      lastUndo = () => void api.messages.undo(opId)
    }
  } catch (e) {
    toast('error', (e as Error).message)
    void loadList({ keepCount: true })
  }
}

let lastUndo: (() => void) | null = null
export function undoLast(): void {
  lastUndo?.()
  lastUndo = null
}

// ---------- open / navigation ----------
export function openThread(id: number | null): void {
  set({ openId: id })
  if (id === null) return
  const s = get()
  const idx = s.rows.findIndex((r) => r.id === id)
  if (idx >= 0) {
    set({ cursor: idx })
    const row = s.rows[idx]
    if (row.unread) void act({ type: 'read', value: true }, [id], { quiet: true })
    // prefetch neighbours
    const neighbours = [s.rows[idx + 1]?.id, s.rows[idx - 1]?.id, s.rows[idx + 2]?.id].filter((x): x is number => !!x)
    void api.messages.prefetch(neighbours)
  }
}

export function moveCursor(delta: number): void {
  const s = get()
  if (!s.rows.length) return
  const next = Math.max(0, Math.min(s.rows.length - 1, s.cursor + delta))
  set({ cursor: next })
  if (s.openId !== null || s.readingPane) {
    if (s.readingPane || s.openId !== null) openThread(s.rows[next].id)
  }
  if (next >= s.rows.length - 10) void loadMoreRows()
}

export function toggleSelect(id: number): void {
  const sel = new Set(get().selected)
  if (sel.has(id)) sel.delete(id)
  else sel.add(id)
  set({ selected: sel })
}

// ---------- compose ----------
let composeSeq = 0
export function openCompose(partial: Partial<Draft> = {}, title = '새 메일'): void {
  const s = get()
  const accountId =
    partial.accountId ?? s.accountFilter ?? (s.view.accountId as string | null) ?? s.accounts[0]?.id ?? ''
  const draft: Draft = {
    accountId,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    attachments: [],
    ...partial
  }
  set({ composes: [...s.composes.slice(-2), { key: ++composeSeq, draft, minimized: false, title }] })
}

export function closeCompose(key: number): void {
  set({ composes: get().composes.filter((c) => c.key !== key) })
}

export function sendCompose(key: number, draft: Draft): void {
  closeCompose(key)
  void api.compose
    .send(draft, 5000)
    .then(({ opId }) => {
      toast(
        'info',
        '보내는 중...',
        {
          label: '실행취소',
          run: () =>
            void api.compose.undoSend(opId).then((d) => {
              if (d) openCompose(d, d.subject || '새 메일')
              else toast('error', '이미 전송되었습니다.')
            })
        },
        5000
      )
    })
    .catch((e: Error) => {
      toast('error', e.message)
      openCompose(draft)
    })
}

const quoteHeader = (m: MessageMeta): string => {
  const d = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(m.date))
  return `${d}, ${m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}님이 작성:`
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function quotedOf(m: MessageMeta): string {
  const b = cachedBody(m.id)
  if (b?.html) return b.html
  if (b?.text) return `<div style="white-space:pre-wrap">${escapeHtml(b.text)}</div>`
  return `<div>${escapeHtml(m.snippet)}</div>`
}

export async function reply(m: MessageMeta, mode: 'reply' | 'replyAll' | 'forward'): Promise<void> {
  // quote the whole previous message, not just its snippet (usually already prefetched, so this is instant)
  if (!cachedBody(m.id)) await fetchBody(m.id).catch(() => undefined)
  const s = get()
  const account = s.accounts.find((a) => a.id === m.accountId)
  const me = account?.email.toLowerCase() ?? ''
  const fmt = (a: { name: string; email: string }): string => (a.name ? `${a.name} <${a.email}>` : a.email)
  if (mode === 'forward') {
    const header = `<div>---------- 전달된 메일 ----------<br>보낸사람: ${escapeHtml(fmt(m.from))}<br>날짜: ${escapeHtml(
      new Date(m.date).toLocaleString('ko-KR')
    )}<br>제목: ${escapeHtml(m.subject)}<br>받는사람: ${escapeHtml(m.to.map(fmt).join(', '))}</div><br>`
    openCompose(
      {
        accountId: m.accountId,
        subject: /^(fwd?|전달)\s*:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`,
        quotedHtml: header + quotedOf(m)
      },
      '전달'
    )
    return
  }
  const fromMe = m.from.email.toLowerCase() === me
  const primary = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from]
  let cc: string[] = []
  if (mode === 'replyAll') {
    const seen = new Set([me, ...primary.map((a) => a.email.toLowerCase())])
    cc = [...m.to, ...m.cc].filter((a) => !seen.has(a.email.toLowerCase()) && (seen.add(a.email.toLowerCase()), true)).map(fmt)
  }
  openCompose(
    {
      accountId: m.accountId,
      to: primary.map(fmt).join(', '),
      cc: cc.join(', '),
      subject: /^(re|회신|답장)\s*:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
      inReplyTo: m.messageIdHeader,
      references: [m.references, m.messageIdHeader].filter(Boolean).join(' '),
      threadId: m.threadId,
      quotedHtml: `<div>${escapeHtml(quoteHeader(m))}</div><blockquote>${quotedOf(m)}</blockquote>`
    },
    mode === 'reply' ? '답장' : '전체답장'
  )
}

// ---------- bootstrap ----------
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let mbTimer: ReturnType<typeof setTimeout> | null = null
export const threadListeners = new Set<() => void>()

export async function refreshAccounts(): Promise<void> {
  const accounts = await api.accounts.list()
  const filter = get().accountFilter
  set({ accounts, accountFilter: filter && accounts.some((a) => a.id === filter) ? filter : null })
}

export async function refreshMailboxes(): Promise<void> {
  set({ mailboxes: await api.mailboxes.list() })
}

let started = false
/** App bootstrap. Idempotent: React StrictMode runs effects twice in dev, and listeners must only be registered once. */
export async function init(): Promise<void> {
  if (started) return
  started = true
  const [accounts, mailboxes, statuses] = await Promise.all([
    api.accounts.list(),
    api.mailboxes.list(),
    api.sync.statuses()
  ])
  set({
    accounts,
    mailboxes,
    statuses: Object.fromEntries(statuses.map((st) => [st.accountId, st])),
    ready: true
  })
  await loadList()

  api.on('mail:changed', () => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      void loadList({ keepCount: true })
      threadListeners.forEach((l) => l())
    }, 60)
  })
  api.on('mailboxes:changed', () => {
    if (mbTimer) clearTimeout(mbTimer)
    mbTimer = setTimeout(() => void refreshMailboxes(), 80)
  })
  api.on('accounts:changed', () => {
    void refreshAccounts()
    void refreshMailboxes()
    void loadList({ keepCount: true })
  })
  api.on('sync:status', (st) => set({ statuses: { ...get().statuses, [st.accountId]: st } }))
  api.on('toast', (t) => toast(t.kind, t.message))
  api.on('download', onDownload)
  api.on('open-message', ({ messageId }) => openThread(messageId))
  api.on('search:updated', ({ token }) => {
    const v = get().view
    if (v.kind === 'search' && v.token === token) void loadList({ keepCount: true })
  })
  api.on('compose:restore', (draft) => openCompose(draft, draft.subject || '새 메일'))
  api.on('app:openSettings', ({ tab }) => openSettings(tab))
  api.on('app:compose', () => openCompose())

  window.addEventListener('focus', () => api.app.focusChanged(true))
}

/** Open the settings dialog, optionally at a tab id ('general', 'rules', ...). */
export function openSettings(tab?: string | null): void {
  set({ settingsOpen: true, settingsTab: tab ?? null })
}
