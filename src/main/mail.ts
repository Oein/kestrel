import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import {
  ACCOUNT_COLORS,
  type Account,
  type ActionRequest,
  type AppEvents,
  type Draft,
  type DraftAttachment,
  type ImapAccountInput,
  type ImapTestResult,
  type MessageBody,
  type SyncStatus,
  type View
} from '../shared/types'
import { computeAfter, expandTargets, sameState } from './actions'
import type { AccountRow, MessageState, Repo } from './db/repo'
import { mailboxId } from './db/repo'
import { buildMime, envelopeOf } from './mime'
import type { OAuthClientService } from './oauthClients'
import { authorize, cancelAuth, decodeIdToken, ReauthRequiredError } from './providers/gmail/oauth'
import { GmailApiProvider } from './providers/gmail/provider'
import { ImapProvider, testImap, type ImapConfig } from './providers/imap/provider'
import type { MailProvider, StateChange } from './providers/types'
import { decryptSecret, encryptSecret } from './secrets'

type Emit = <K extends keyof AppEvents>(channel: K, payload: AppEvents[K]) => void

interface PendingAction {
  kind: 'action'
  id: string
  changes: Map<string, StateChange[]> // by account
  timer: NodeJS.Timeout | null
  committed: boolean
}

interface PendingSend {
  kind: 'send'
  id: string
  draft: Draft
  timer: NodeJS.Timeout | null
  committed: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class MailService {
  private providers = new Map<string, MailProvider>()
  private statuses = new Map<string, SyncStatus>()
  private syncing = new Map<string, Promise<void>>()
  private resyncRequested = new Set<string>()
  private initialSynced = new Set<string>()
  private ops = new Map<string, PendingAction | PendingSend>()
  private commitChains = new Map<string, Promise<void>>()
  private bodyInflight = new Map<number, Promise<MessageBody>>()
  private prefetchQueue: number[] = []
  private prefetching = false
  private badgeTimer: NodeJS.Timeout | null = null
  private lastFocusSync = 0

  constructor(
    private repo: Repo,
    private oauth: OAuthClientService,
    private emit: Emit,
    private getWindow: () => BrowserWindow | null
  ) {}

  // ---------- lifecycle ----------
  start(): void {
    for (const row of this.repo.accountRows()) this.startAccount(row)
    this.updateBadge()
  }

  private startAccount(row: AccountRow): void {
    try {
      const p = this.createProvider(row)
      this.providers.set(row.id, p)
      p.watch(() => void this.syncAccount(row.id))
      void this.syncAccount(row.id)
    } catch (e) {
      this.setStatus(row.id, 'error', (e as Error).message)
    }
  }

  async stop(): Promise<void> {
    await this.flushOps()
    await Promise.all([...this.providers.values()].map((p) => p.close().catch(() => {})))
  }

  private createProvider(row: AccountRow): MailProvider {
    if (row.provider === 'gmail') {
      return new GmailApiProvider(row.id, this.repo, {
        credentials: () => {
          const fresh = this.repo.accountRow(row.id)
          const clientId = fresh?.oauth_client_id ?? this.oauth.pick(row.email)
          if (!clientId) throw new ReauthRequiredError('OAuth 클라이언트가 없습니다.')
          return this.oauth.credentials(clientId)
        },
        refreshToken: () => {
          const s = decryptSecret<{ refreshToken: string }>(this.repo.accountRow(row.id)?.secret)
          if (!s?.refreshToken) throw new ReauthRequiredError()
          return s.refreshToken
        },
        onReauthRequired: () => this.markReauth(row.id)
      })
    }
    const cfg = JSON.parse(row.config_json) as ImapConfig
    return new ImapProvider(row.id, this.repo, cfg, () => {
      const s = decryptSecret<{ password: string }>(this.repo.accountRow(row.id)?.secret)
      if (!s) throw new Error('저장된 비밀번호를 복호화할 수 없습니다.')
      return s.password
    })
  }

  private markReauth(accountId: string): void {
    const row = this.repo.accountRow(accountId)
    if (!row || row.needs_reauth) return
    this.repo.setNeedsReauth(accountId, true)
    this.setStatus(accountId, 'error', '재로그인 필요')
    this.emit('accounts:changed', {})
  }

  // ---------- sync ----------
  private setStatus(accountId: string, state: SyncStatus['state'], message?: string): void {
    const prev = this.statuses.get(accountId)
    const st: SyncStatus = {
      accountId,
      state,
      message,
      lastSync: state === 'idle' ? Date.now() : prev?.lastSync
    }
    this.statuses.set(accountId, st)
    this.emit('sync:status', st)
  }

  getStatuses(): SyncStatus[] {
    return [...this.statuses.values()]
  }

  syncAll(): void {
    for (const id of this.providers.keys()) void this.syncAccount(id)
  }

  onFocus(): void {
    if (Date.now() - this.lastFocusSync < 5000) return
    this.lastFocusSync = Date.now()
    this.syncAll()
  }

  syncAccount(accountId: string): Promise<void> {
    const running = this.syncing.get(accountId)
    if (running) {
      this.resyncRequested.add(accountId)
      return running
    }
    const p = (async () => {
      try {
        do {
          this.resyncRequested.delete(accountId)
          await this.syncOnce(accountId)
        } while (this.resyncRequested.has(accountId))
      } finally {
        this.syncing.delete(accountId)
      }
    })()
    this.syncing.set(accountId, p)
    return p
  }

  private async syncOnce(accountId: string): Promise<void> {
    const provider = this.providers.get(accountId)
    const row = this.repo.accountRow(accountId)
    if (!provider || !row) return
    if (row.needs_reauth) {
      this.setStatus(accountId, 'error', '재로그인 필요')
      return
    }
    const first = !this.initialSynced.has(accountId)
    this.setStatus(accountId, 'syncing')
    try {
      if (first) {
        await provider.syncFolders()
        this.emit('mailboxes:changed', { accountId })
      }
      const out = await provider.sync()
      this.initialSynced.add(accountId)
      this.setStatus(accountId, 'idle')
      if (out.changed || first) {
        this.emit('mail:changed', { accountIds: [accountId] })
        this.emit('mailboxes:changed', { accountId })
        this.updateBadge()
      }
      if (!first && out.newInboxIds.length) this.notify(out.newInboxIds)
    } catch (e) {
      const err = e as Error & { code?: string }
      if (e instanceof ReauthRequiredError) {
        this.markReauth(accountId)
        return
      }
      const offline = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(err.code ?? '') || /fetch failed/.test(err.message)
      console.warn(`[sync ${accountId}]`, err.message)
      this.setStatus(accountId, offline ? 'offline' : 'error', offline ? '오프라인' : err.message)
    }
  }

  // ---------- notifications / badge ----------
  private notify(ids: number[]): void {
    const win = this.getWindow()
    if (win?.isFocused() || !Notification.isSupported()) return
    const metas = ids.map((id) => this.repo.meta(id)).filter((m) => m && m.unread)
    const show = metas.slice(0, 3)
    for (const m of show) {
      if (!m) continue
      const n = new Notification({
        title: m.from.name || m.from.email,
        subtitle: m.subject || '(제목 없음)',
        body: m.snippet,
        silent: false
      })
      n.on('click', () => {
        const w = this.getWindow()
        if (w) {
          if (w.isMinimized()) w.restore()
          w.show()
          w.focus()
        }
        this.emit('open-message', { messageId: m.id })
      })
      n.show()
    }
    if (metas.length > show.length) {
      new Notification({ title: 'Mailbird', body: `새 메일 ${metas.length - show.length}통이 더 있습니다.` }).show()
    }
  }

  updateBadge(): void {
    if (this.badgeTimer) clearTimeout(this.badgeTimer)
    this.badgeTimer = setTimeout(() => {
      const n = this.repo.unreadInboxTotal()
      app.setBadgeCount(n)
    }, 200)
  }

  private changed(accountIds: string[]): void {
    this.emit('mail:changed', { accountIds })
    for (const id of accountIds) this.emit('mailboxes:changed', { accountId: id })
    this.updateBadge()
  }

  // ---------- accounts ----------
  async addGmail(opts: { email?: string; oauthClientId?: string }): Promise<Account> {
    const clientRowId = opts.oauthClientId || (opts.email ? this.oauth.pick(opts.email) : this.oauth.pick(''))
    if (!clientRowId) throw new Error('NO_OAUTH_CLIENT')
    const creds = this.oauth.credentials(clientRowId)
    const tok = await authorize(creds, opts.email?.trim() || undefined)
    const claims = decodeIdToken(tok.id_token) as { email?: string; name?: string }
    const email = claims.email ?? opts.email ?? ''
    if (!email) throw new Error('계정 이메일을 확인할 수 없습니다.')
    const secret = encryptSecret({ refreshToken: tok.refresh_token })
    const existing = this.repo.findAccountByEmail('gmail', email)
    let id: string
    if (existing) {
      id = existing.id
      this.repo.updateAccountSecret(id, secret, clientRowId)
      await this.providers.get(id)?.close()
    } else {
      id = randomUUID()
      this.repo.insertAccount({
        id,
        provider: 'gmail',
        preset: 'gmail',
        email,
        name: claims.name ?? '',
        color: this.nextColor(),
        config_json: '{}',
        secret,
        oauth_client_id: clientRowId
      })
    }
    const row = this.repo.accountRow(id)!
    this.startAccount(row)
    const p = this.providers.get(id)
    if (p instanceof GmailApiProvider) p.api.setAccessToken(tok.access_token, tok.expires_in)
    this.emit('accounts:changed', {})
    return this.repo.listAccounts().find((a) => a.id === id)!
  }

  async reauth(accountId: string): Promise<Account> {
    const row = this.repo.accountRow(accountId)
    if (!row) throw new Error('계정을 찾을 수 없습니다.')
    if (row.provider !== 'gmail') throw new Error('Gmail 계정만 재로그인할 수 있습니다.')
    const clientRowId = (row.oauth_client_id && this.repo.oauthClientRow(row.oauth_client_id) ? row.oauth_client_id : null) ?? this.oauth.pick(row.email)
    if (!clientRowId) throw new Error('NO_OAUTH_CLIENT')
    const tok = await authorize(this.oauth.credentials(clientRowId), row.email)
    const claims = decodeIdToken(tok.id_token) as { email?: string }
    if (claims.email && claims.email.toLowerCase() !== row.email.toLowerCase()) {
      throw new Error(`다른 계정(${claims.email})으로 로그인했습니다. ${row.email}(으)로 로그인하세요.`)
    }
    this.repo.updateAccountSecret(accountId, encryptSecret({ refreshToken: tok.refresh_token }), clientRowId)
    await this.providers.get(accountId)?.close()
    this.startAccount(this.repo.accountRow(accountId)!)
    const p = this.providers.get(accountId)
    if (p instanceof GmailApiProvider) p.api.setAccessToken(tok.access_token, tok.expires_in)
    this.emit('accounts:changed', {})
    return this.repo.listAccounts().find((a) => a.id === accountId)!
  }

  cancelAuth(): void {
    cancelAuth()
  }

  private imapConfig(input: ImapAccountInput): ImapConfig {
    return {
      email: input.email.trim(),
      name: input.name.trim(),
      username: input.username.trim() || input.email.trim(),
      imap: input.imap,
      smtp: input.smtp,
      // iCloud & Naver store sent mail on the server themselves
      appendSent: input.preset === 'custom'
    }
  }

  async testImap(input: ImapAccountInput): Promise<ImapTestResult> {
    const r = await testImap(this.imapConfig(input), input.password)
    return { ok: !r.imap && !r.smtp, imap: r.imap, smtp: r.smtp }
  }

  async addImap(input: ImapAccountInput): Promise<Account> {
    const test = await this.testImap(input)
    if (!test.ok) throw new Error(test.imap ?? test.smtp ?? '연결 실패')
    const cfg = this.imapConfig(input)
    if (this.repo.findAccountByEmail('imap', cfg.email)) throw new Error('이미 추가된 계정입니다.')
    const id = randomUUID()
    this.repo.insertAccount({
      id,
      provider: 'imap',
      preset: input.preset,
      email: cfg.email,
      name: cfg.name,
      color: this.nextColor(),
      config_json: JSON.stringify(cfg),
      secret: encryptSecret({ password: input.password }),
      oauth_client_id: null
    })
    this.startAccount(this.repo.accountRow(id)!)
    this.emit('accounts:changed', {})
    return this.repo.listAccounts().find((a) => a.id === id)!
  }

  async removeAccount(id: string): Promise<void> {
    await this.providers.get(id)?.close()
    this.providers.delete(id)
    this.statuses.delete(id)
    this.initialSynced.delete(id)
    this.repo.deleteAccount(id)
    this.emit('accounts:changed', {})
    this.changed([id])
  }

  private nextColor(): string {
    const used = new Set(this.repo.listAccounts().map((a) => a.color))
    return ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[this.repo.listAccounts().length % ACCOUNT_COLORS.length]
  }

  // ---------- bodies ----------
  getBody(id: number): Promise<MessageBody> {
    const cached = this.repo.getBody(id)
    if (cached) return Promise.resolve(cached)
    const inflight = this.bodyInflight.get(id)
    if (inflight) return inflight
    const p = (async () => {
      try {
        await this.fetchBodies([id])
        const b = this.repo.getBody(id)
        if (!b) throw new Error('본문을 불러오지 못했습니다.')
        return b
      } finally {
        this.bodyInflight.delete(id)
      }
    })()
    this.bodyInflight.set(id, p)
    return p
  }

  private async fetchBodies(ids: number[]): Promise<void> {
    const refs = this.repo.refs(ids)
    const byAccount = new Map<string, typeof refs>()
    for (const r of refs) byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r])
    await Promise.all(
      [...byAccount].map(async ([accountId, list]) => {
        const p = this.providers.get(accountId)
        if (!p) throw new Error('계정이 연결되어 있지 않습니다.')
        const bodies = await p.fetchBodies(list)
        for (const [id, b] of bodies) {
          this.repo.putBody(id, { html: b.html, text: b.text, attachments: b.attachments }, b.plain, b.snippet)
        }
      })
    )
  }

  prefetch(ids: number[]): void {
    const need = ids.filter((id) => !this.repo.hasBody(id) && !this.bodyInflight.has(id) && !this.prefetchQueue.includes(id))
    if (!need.length) return
    // newest requests first (e.g. next/prev of the open message)
    this.prefetchQueue.unshift(...need)
    void this.runPrefetch()
  }

  private async runPrefetch(): Promise<void> {
    if (this.prefetching) return
    this.prefetching = true
    try {
      while (this.prefetchQueue.length) {
        const usable = new Set(this.repo.accountRows().filter((a) => !a.needs_reauth && this.statuses.get(a.id)?.state !== 'error').map((a) => a.id))
        const chunk = this.prefetchQueue
          .splice(0, 10)
          .filter((id) => !this.repo.hasBody(id) && usable.has(this.repo.ref(id)?.accountId ?? ''))
        if (!chunk.length) continue
        // registers inflight promises so getBody() can join an in-progress prefetch
        await this.fetchBatch(chunk).catch((e: Error) => console.warn('[prefetch]', e.message))
        await sleep(20)
      }
    } finally {
      this.prefetching = false
    }
  }

  private async fetchBatch(ids: number[]): Promise<void> {
    const p = this.fetchBodies(ids)
    for (const id of ids) {
      if (!this.bodyInflight.has(id)) {
        const bp = p.then(() => {
          const b = this.repo.getBody(id)
          if (!b) throw new Error('본문을 불러오지 못했습니다.')
          return b
        })
        bp.catch(() => {}).finally(() => this.bodyInflight.delete(id))
        this.bodyInflight.set(id, bp)
      }
    }
    await p
  }

  // ---------- optimistic actions ----------
  act(req: ActionRequest): { opId: string } {
    const targets = expandTargets(this.repo, req.messageIds, req.action, req.expandThreads)
    const before = this.repo.states(targets)
    const refs = new Map(this.repo.refs(targets).map((r) => [r.id, r]))
    const changes = new Map<string, StateChange[]>()
    const afterStates: MessageState[] = []
    const roleCache = new Map<string, string | null>()
    for (const st of before) {
      const ref = refs.get(st.id)
      if (!ref) continue
      const account = this.repo.accountRow(ref.accountId)
      if (!account) continue
      const roleId = (role: string): string | null => {
        const key = `${ref.accountId}|${role}`
        if (!roleCache.has(key)) {
          const mb = this.repo.mailboxByRole(ref.accountId, role as never)
          roleCache.set(key, mb?.id ?? (account.provider === 'gmail' && role === 'inbox' ? mailboxId(ref.accountId, 'INBOX') : null))
        }
        return roleCache.get(key)!
      }
      // throws ActionError (e.g. no archive folder) → surfaced to the renderer, which rolls back
      const after = computeAfter(req.action, st, { kind: account.provider, accountId: ref.accountId, roleId })
      if (sameState(st, after)) continue
      afterStates.push(after)
      changes.set(ref.accountId, [...(changes.get(ref.accountId) ?? []), { ref, before: st, after }])
    }
    const opId = randomUUID()
    if (!afterStates.length) return { opId }
    this.repo.applyStates(afterStates)
    this.changed([...changes.keys()])
    const op: PendingAction = { kind: 'action', id: opId, changes, timer: null, committed: false }
    this.ops.set(opId, op)
    const delay = req.delayMs ?? 0
    op.timer = setTimeout(() => void this.commitAction(op), delay)
    // forget old ops after a while
    setTimeout(() => this.ops.delete(opId), delay + 60_000)
    return { opId }
  }

  private commitAction(op: PendingAction, inverse = false): Promise<void> {
    op.timer = null
    op.committed = true
    const tasks: Promise<void>[] = []
    for (const [accountId, list] of op.changes) {
      const changes = inverse ? list.map((c) => ({ ref: c.ref, before: c.after, after: c.before })) : list
      const prev = this.commitChains.get(accountId) ?? Promise.resolve()
      const next = prev.then(async () => {
        const provider = this.providers.get(accountId)
        try {
          if (!provider) throw new Error('계정이 연결되어 있지 않습니다.')
          await this.withRetry(() => provider.applyChanges(changes))
          if (provider.kind === 'imap') this.changed([accountId]) // uid remaps
        } catch (e) {
          console.warn('[action] remote apply failed, rolling back', (e as Error).message)
          // roll back only messages still in the optimistic state
          const current = new Map(this.repo.states(changes.map((c) => c.ref.id)).map((s) => [s.id, s]))
          const revert = changes.filter((c) => {
            const cur = current.get(c.ref.id)
            return cur && sameState(cur, c.after)
          })
          this.repo.applyStates(revert.map((c) => c.before))
          this.changed([accountId])
          this.emit('toast', { kind: 'error', message: `서버에 반영하지 못해 되돌렸습니다: ${(e as Error).message}` })
          this.emit('op:reverted', { opId: op.id, reason: (e as Error).message })
        }
      })
      this.commitChains.set(accountId, next.catch(() => {}))
      tasks.push(next)
    }
    return Promise.all(tasks).then(() => {})
  }

  private async withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    let last: unknown
    for (let i = 0; i < tries; i++) {
      try {
        return await fn()
      } catch (e) {
        last = e
        if (e instanceof ReauthRequiredError) break
        await sleep(500 * 2 ** i)
      }
    }
    throw last
  }

  undo(opId: string): boolean {
    const op = this.ops.get(opId)
    if (!op || op.kind !== 'action') return false
    this.ops.delete(opId)
    const all = [...op.changes.values()].flat()
    // local revert first (instant)
    this.repo.applyStates(all.map((c) => c.before))
    this.changed([...op.changes.keys()])
    if (op.timer) {
      clearTimeout(op.timer)
      op.timer = null
      return true
    }
    // already committed: push the inverse to the server
    void this.commitAction(op, true)
    return true
  }

  private async flushOps(): Promise<void> {
    const pending: Promise<void>[] = []
    for (const op of this.ops.values()) {
      if (!op.timer) continue
      clearTimeout(op.timer)
      pending.push(op.kind === 'action' ? this.commitAction(op) : this.commitSend(op))
    }
    await Promise.race([Promise.all(pending), sleep(8000)])
  }

  // ---------- send ----------
  send(draft: Draft, delayMs: number): { opId: string } {
    if (!this.repo.accountRow(draft.accountId)) throw new Error('보낼 계정을 선택하세요.')
    const id = randomUUID()
    const op: PendingSend = { kind: 'send', id, draft, timer: null, committed: false }
    this.ops.set(id, op)
    op.timer = setTimeout(() => void this.commitSend(op), delayMs)
    return { opId: id }
  }

  undoSend(opId: string): Draft | null {
    const op = this.ops.get(opId)
    if (!op || op.kind !== 'send' || !op.timer) return null
    clearTimeout(op.timer)
    this.ops.delete(opId)
    return op.draft
  }

  private async commitSend(op: PendingSend): Promise<void> {
    op.timer = null
    op.committed = true
    this.ops.delete(op.id)
    const { draft } = op
    try {
      const row = this.repo.accountRow(draft.accountId)
      const provider = this.providers.get(draft.accountId)
      if (!row || !provider) throw new Error('계정이 연결되어 있지 않습니다.')
      const from = { name: row.name, email: row.email }
      const raw = await buildMime(draft, { from, keepBcc: row.provider === 'gmail' })
      await this.withRetry(() => provider.send(raw, draft, envelopeOf(draft, from)), 2)
      this.emit('toast', { kind: 'success', message: '메일을 보냈습니다.' })
      setTimeout(() => void this.syncAccount(draft.accountId), 1500)
    } catch (e) {
      console.warn('[send] failed', (e as Error).message)
      this.emit('toast', { kind: 'error', message: `메일을 보내지 못했습니다: ${(e as Error).message}` })
      this.emit('compose:restore', draft)
    }
  }

  async pickFiles(): Promise<DraftAttachment[]> {
    const win = this.getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (res.canceled) return []
    return Promise.all(
      res.filePaths.map(async (p) => ({ path: p, filename: basename(p), size: (await stat(p)).size }))
    )
  }

  // ---------- paging / search ----------
  async loadMore(view: View): Promise<number> {
    const targets: [string, string | null][] = []
    if (view.kind === 'label') targets.push([view.accountId, view.mailboxId])
    else if (view.kind === 'role') {
      const accounts = view.accountId ? [view.accountId] : [...this.providers.keys()]
      for (const a of accounts) {
        const role = view.role === 'starred' || view.role === 'all' ? null : view.role
        const mb = role ? this.repo.mailboxByRole(a, role) : null
        if (role && !mb) continue
        targets.push([a, mb?.id ?? null])
      }
    } else return 0
    let n = 0
    await Promise.all(
      targets.map(async ([accountId, mb]) => {
        try {
          n += (await this.providers.get(accountId)?.backfill(mb)) ?? 0
        } catch (e) {
          console.warn('[loadMore]', (e as Error).message)
        }
      })
    )
    if (n) this.changed(targets.map((t) => t[0]))
    return n
  }

  remoteSearch(query: string, accountId: string | null): string {
    const token = randomUUID()
    const hits = new Set<number>()
    this.repo.remoteSearchHits.set(token, hits)
    // keep only the latest few tokens
    const keys = [...this.repo.remoteSearchHits.keys()]
    for (const k of keys.slice(0, Math.max(0, keys.length - 5))) this.repo.remoteSearchHits.delete(k)
    const accounts = accountId ? [accountId] : [...this.providers.keys()]
    void Promise.all(
      accounts.map(async (a) => {
        try {
          const ids = (await this.providers.get(a)?.search(query)) ?? []
          ids.forEach((id) => hits.add(id))
          this.emit('search:updated', { token })
        } catch (e) {
          console.warn('[search]', (e as Error).message)
        }
      })
    )
    return token
  }

  // ---------- attachments ----------
  private async attachmentData(messageId: number, attachmentId: string): Promise<{ data: Buffer; filename: string }> {
    const ref = this.repo.ref(messageId)
    if (!ref) throw new Error('메시지를 찾을 수 없습니다.')
    const body = this.repo.getBody(messageId)
    const att =
      body?.attachments.find((a) => a.id === attachmentId) ?? ref.attachments.find((a) => a.id === attachmentId)
    if (!att) throw new Error('첨부파일을 찾을 수 없습니다.')
    const provider = this.providers.get(ref.accountId)
    if (!provider) throw new Error('계정이 연결되어 있지 않습니다.')
    const data = await provider.fetchAttachment(ref, att)
    return { data, filename: att.filename.replace(/[/\\:]/g, '_') || 'attachment' }
  }

  async openAttachment(messageId: number, attachmentId: string): Promise<void> {
    const { data, filename } = await this.attachmentData(messageId, attachmentId)
    const dir = join(app.getPath('temp'), 'mailbird', String(messageId))
    await mkdir(dir, { recursive: true })
    const file = join(dir, filename)
    await writeFile(file, data)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  }

  async saveAttachment(messageId: number, attachmentId: string): Promise<void> {
    const ref = this.repo.ref(messageId)
    const name = ref?.attachments.find((a) => a.id === attachmentId)?.filename ?? 'attachment'
    const win = this.getWindow()
    const opts = { defaultPath: join(app.getPath('downloads'), name) }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return
    const { data } = await this.attachmentData(messageId, attachmentId)
    await writeFile(res.filePath, data)
    this.emit('toast', { kind: 'success', message: '첨부파일을 저장했습니다.' })
  }
}
