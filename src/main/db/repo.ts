import Database from 'better-sqlite3'
import type {
  Account,
  Address,
  AttachmentInfo,
  ImapPreset,
  Mailbox,
  MailboxRole,
  MessageBody,
  MessageMeta,
  ProviderKind,
  Rule,
  RuleLanguage,
  RuleSampleMessage,
  ThreadRow,
  View
} from '../../shared/types'
import { migrate } from './migrations'

export interface AccountRow {
  id: string
  provider: ProviderKind
  preset: ImapPreset | 'gmail'
  email: string
  name: string
  color: string
  config_json: string
  secret: Buffer | null
  sync_json: string
  oauth_client_id: string | null
  needs_reauth: number
}

export interface OAuthClientRow {
  id: string
  name: string
  client_id: string
  client_secret: Buffer | null
  domains: string
  is_default: number
  created_at: number
}

export interface MailboxUpsert {
  remoteId: string
  name: string
  path: string
  role: MailboxRole | null
  type: 'system' | 'user' | 'category'
  colorBg?: string | null
  colorText?: string | null
}

export interface MessageUpsert {
  remoteId: string
  threadId: string
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  replyTo: Address[]
  snippet: string
  date: number
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  attachments: AttachmentInfo[]
  messageIdHeader: string | null
  inReplyTo: string | null
  references: string | null
  size: number
  /** full mailbox ids (`${accountId}:${remoteId}`) */
  mailboxIds: string[]
}

export interface RuleRow {
  id: string
  name: string
  enabled: number
  language: RuleLanguage
  code: string
  account_id: string | null
  sort: number
  created_at: number
  last_error: string | null
  last_run_at: number | null
  hit_count: number
}

export interface MailboxInfoRow {
  id: string
  account_id: string
  remote_id: string
  name: string
  path: string
  role: MailboxRole | null
  type: 'system' | 'user' | 'category'
}

/** Local-only category "mailboxes" for IMAP accounts so the inbox category tabs work there too. */
export const LOCAL_CATEGORIES: MailboxUpsert[] = [
  { remoteId: 'CATEGORY_PROMOTIONS', name: '프로모션', path: '프로모션', role: null, type: 'category' },
  { remoteId: 'CATEGORY_SOCIAL', name: '소셜', path: '소셜', role: null, type: 'category' },
  { remoteId: 'CATEGORY_UPDATES', name: '업데이트', path: '업데이트', role: null, type: 'category' }
]

/** Label ids of the form `${accountId}:CATEGORY_*` (Gmail categories, or local IMAP categories). */
export const isCategoryLabel = (accountId: string, labelId: string): boolean =>
  labelId.startsWith(`${accountId}:CATEGORY_`)

export interface MessageState {
  id: number
  isRead: boolean
  isStarred: boolean
  labels: string[]
}

export interface LocalMessageRef {
  id: number
  accountId: string
  remoteId: string
  threadId: string
  attachments: AttachmentInfo[]
}

interface MessageRowDb {
  id: number
  account_id: string
  remote_id: string
  thread_id: string
  subject: string
  from_name: string
  from_email: string
  to_json: string
  cc_json: string
  reply_to_json: string
  snippet: string
  date: number
  is_read: number
  is_starred: number
  has_attachments: number
  attachments_json: string
  message_id_header: string | null
  in_reply_to: string | null
  refs: string | null
}

export const mailboxId = (accountId: string, remoteId: string): string => `${accountId}:${remoteId}`

const NOT_TRASH = `NOT EXISTS (SELECT 1 FROM message_labels xl JOIN mailboxes xb ON xb.id = xl.mailbox_id
  WHERE xl.message_id = m.id AND xb.role IN ('trash','junk'))`

const hasRole = (role: string): string => `EXISTS (SELECT 1 FROM message_labels rl JOIN mailboxes rb ON rb.id = rl.mailbox_id
  WHERE rl.message_id = m.id AND rb.role = '${role}')`

const CATEGORY_IDS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']

/** Turn a user query into an FTS5 MATCH expression, supporting from:/to:/subject: prefixes. */
export function buildFtsQuery(query: string): { match: string | null; unread: boolean; attachment: boolean; starred: boolean } {
  const parts: string[] = []
  let unread = false
  let attachment = false
  let starred = false
  const tokens = query.match(/(\w+:)?("[^"]*"|\S+)/g) ?? []
  for (const tok of tokens) {
    const m = /^(\w+):(.*)$/.exec(tok)
    let col: string | null = null
    let term = tok
    if (m) {
      const key = m[1].toLowerCase()
      const val = m[2]
      if (key === 'is' && val === 'unread') { unread = true; continue }
      if (key === 'is' && val === 'starred') { starred = true; continue }
      if (key === 'has' && val === 'attachment') { attachment = true; continue }
      if (key === 'from') col = 'sender'
      else if (key === 'to') col = 'recipients'
      else if (key === 'subject') col = 'subject'
      if (col) term = val
    }
    const clean = term.replace(/^"|"$/g, '').replace(/"/g, '""').trim()
    if (!clean) continue
    // split on punctuation the unicode61 tokenizer would split on, then prefix-match each piece
    const pieces = clean.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    for (const p of pieces) {
      const expr = `"${p}"*`
      parts.push(col ? `${col} : ${expr}` : expr)
    }
  }
  return { match: parts.length ? parts.join(' AND ') : null, unread, attachment, starred }
}

export class Repo {
  db: Database.Database
  /** search token -> local message ids found by server-side search */
  remoteSearchHits = new Map<string, Set<number>>()

  constructor(file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('cache_size = -32000')
    migrate(this.db)
  }

  close(): void {
    this.db.close()
  }

  // ---------- accounts ----------
  listAccounts(): Account[] {
    return (this.db.prepare('SELECT * FROM accounts ORDER BY sort, created_at').all() as AccountRow[]).map(toAccount)
  }

  accountRows(): AccountRow[] {
    return this.db.prepare('SELECT * FROM accounts ORDER BY sort, created_at').all() as AccountRow[]
  }

  accountRow(id: string): AccountRow | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
  }

  insertAccount(row: Omit<AccountRow, 'sync_json' | 'needs_reauth'>): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, provider, preset, email, name, color, config_json, secret, oauth_client_id, created_at, sort)
         VALUES (@id, @provider, @preset, @email, @name, @color, @config_json, @secret, @oauth_client_id, @created_at,
           (SELECT COALESCE(MAX(sort), 0) + 1 FROM accounts))`
      )
      .run({ ...row, created_at: Date.now() })
  }

  updateAccountSecret(id: string, secret: Buffer, oauthClientId?: string | null): void {
    if (oauthClientId !== undefined)
      this.db
        .prepare('UPDATE accounts SET secret = ?, oauth_client_id = ?, needs_reauth = 0 WHERE id = ?')
        .run(secret, oauthClientId, id)
    else this.db.prepare('UPDATE accounts SET secret = ?, needs_reauth = 0 WHERE id = ?').run(secret, id)
  }

  setNeedsReauth(id: string, value: boolean): void {
    this.db.prepare('UPDATE accounts SET needs_reauth = ? WHERE id = ?').run(value ? 1 : 0, id)
  }

  findAccountByEmail(provider: ProviderKind, email: string): AccountRow | undefined {
    return this.db
      .prepare('SELECT * FROM accounts WHERE provider = ? AND lower(email) = lower(?)')
      .get(provider, email) as AccountRow | undefined
  }

  // ---------- kv ----------
  getKv<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return r ? (JSON.parse(r.value) as T) : fallback
  }

  setKv(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
  }

  // ---------- oauth clients ----------
  oauthClientRows(): OAuthClientRow[] {
    return this.db.prepare('SELECT * FROM oauth_clients ORDER BY is_default DESC, created_at').all() as OAuthClientRow[]
  }

  oauthClientRow(id: string): OAuthClientRow | undefined {
    return this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as OAuthClientRow | undefined
  }

  oauthClientUsage(): Map<string, number> {
    const rows = this.db
      .prepare('SELECT oauth_client_id AS id, COUNT(*) AS c FROM accounts WHERE oauth_client_id IS NOT NULL GROUP BY oauth_client_id')
      .all() as { id: string; c: number }[]
    return new Map(rows.map((r) => [r.id, r.c]))
  }

  upsertOAuthClient(row: Omit<OAuthClientRow, 'created_at' | 'client_secret'> & { client_secret?: Buffer | null }): void {
    this.db.transaction(() => {
      if (row.is_default) this.db.prepare('UPDATE oauth_clients SET is_default = 0').run()
      const exists = this.oauthClientRow(row.id)
      if (exists) {
        this.db
          .prepare('UPDATE oauth_clients SET name = ?, client_id = ?, domains = ?, is_default = ? WHERE id = ?')
          .run(row.name, row.client_id, row.domains, row.is_default, row.id)
        if (row.client_secret !== undefined)
          this.db.prepare('UPDATE oauth_clients SET client_secret = ? WHERE id = ?').run(row.client_secret, row.id)
      } else {
        this.db
          .prepare(
            'INSERT INTO oauth_clients (id, name, client_id, client_secret, domains, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .run(row.id, row.name, row.client_id, row.client_secret ?? null, row.domains, row.is_default, Date.now())
      }
      // always keep exactly one default when any client exists
      const hasDefault = this.db.prepare('SELECT 1 FROM oauth_clients WHERE is_default = 1').get()
      if (!hasDefault)
        this.db.prepare('UPDATE oauth_clients SET is_default = 1 WHERE id = (SELECT id FROM oauth_clients ORDER BY created_at LIMIT 1)').run()
    })()
  }

  setDefaultOAuthClient(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE oauth_clients SET is_default = 0').run()
      this.db.prepare('UPDATE oauth_clients SET is_default = 1 WHERE id = ?').run(id)
    })()
  }

  deleteOAuthClient(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id)
      const hasDefault = this.db.prepare('SELECT 1 FROM oauth_clients WHERE is_default = 1').get()
      if (!hasDefault)
        this.db.prepare('UPDATE oauth_clients SET is_default = 1 WHERE id = (SELECT id FROM oauth_clients ORDER BY created_at LIMIT 1)').run()
    })()
  }

  getAccountSync<T>(id: string): T {
    const r = this.db.prepare('SELECT sync_json FROM accounts WHERE id = ?').get(id) as { sync_json: string } | undefined
    return JSON.parse(r?.sync_json ?? '{}') as T
  }

  setAccountSync(id: string, state: unknown): void {
    this.db.prepare('UPDATE accounts SET sync_json = ? WHERE id = ?').run(JSON.stringify(state), id)
  }

  deleteAccount(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?)').run(id)
      this.db.prepare('DELETE FROM message_labels WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE account_id = ?)').run(id)
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    })()
  }

  // ---------- mailboxes ----------
  /** `keepCategories`: keep existing category mailboxes not in `list` (IMAP local categories). */
  replaceMailboxes(accountId: string, list: MailboxUpsert[], opts: { keepCategories?: boolean } = {}): void {
    const upsert = this.db.prepare(
      `INSERT INTO mailboxes (id, account_id, remote_id, name, path, role, type, color_bg, color_text)
       VALUES (@id, @account_id, @remote_id, @name, @path, @role, @type, @color_bg, @color_text)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, role = excluded.role,
         type = excluded.type, color_bg = excluded.color_bg, color_text = excluded.color_text`
    )
    this.db.transaction(() => {
      const keep = new Set<string>()
      for (const mb of list) {
        const id = mailboxId(accountId, mb.remoteId)
        keep.add(id)
        upsert.run({
          id,
          account_id: accountId,
          remote_id: mb.remoteId,
          name: mb.name,
          path: mb.path,
          role: mb.role,
          type: mb.type,
          color_bg: mb.colorBg ?? null,
          color_text: mb.colorText ?? null
        })
      }
      const existing = this.db.prepare('SELECT id, type FROM mailboxes WHERE account_id = ?').all(accountId) as { id: string; type: string }[]
      for (const { id, type } of existing) {
        if (opts.keepCategories && type === 'category') continue
        if (!keep.has(id)) {
          this.db.prepare('DELETE FROM message_labels WHERE mailbox_id = ?').run(id)
          this.db.prepare('DELETE FROM mailboxes WHERE id = ?').run(id)
        }
      }
    })()
  }

  listMailboxes(): Mailbox[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, COALESCE(c.unread, 0) AS unread FROM mailboxes b
         LEFT JOIN (
           SELECT l.mailbox_id, COUNT(DISTINCT m.thread_id) AS unread
           FROM message_labels l JOIN messages m ON m.id = l.message_id
           WHERE m.is_read = 0 GROUP BY l.mailbox_id
         ) c ON c.mailbox_id = b.id
         ORDER BY b.account_id, b.type, b.path COLLATE NOCASE`
      )
      .all() as {
      id: string
      account_id: string
      remote_id: string
      name: string
      path: string
      role: MailboxRole | null
      type: Mailbox['type']
      color_bg: string | null
      color_text: string | null
      unread: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      remoteId: r.remote_id,
      name: r.name,
      path: r.path,
      role: r.role,
      type: r.type,
      colorBg: r.color_bg,
      colorText: r.color_text,
      unread: r.unread
    }))
  }

  mailboxRow(id: string): { id: string; account_id: string; remote_id: string; role: MailboxRole | null; sync_json: string; type: string } | undefined {
    return this.db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(id) as never
  }

  mailboxesOf(accountId: string): { id: string; remote_id: string; role: MailboxRole | null; sync_json: string; type: string }[] {
    return this.db.prepare('SELECT * FROM mailboxes WHERE account_id = ?').all(accountId) as never
  }

  mailboxByRole(accountId: string, role: MailboxRole): { id: string; remote_id: string } | undefined {
    return this.db.prepare('SELECT id, remote_id FROM mailboxes WHERE account_id = ? AND role = ?').get(accountId, role) as never
  }

  mailboxInfos(accountId: string): MailboxInfoRow[] {
    return this.db
      .prepare('SELECT id, account_id, remote_id, name, path, role, type FROM mailboxes WHERE account_id = ?')
      .all(accountId) as MailboxInfoRow[]
  }

  /** Create the local category mailboxes of an IMAP account (idempotent). */
  ensureLocalCategories(accountId: string): boolean {
    const have = new Set(this.mailboxInfos(accountId).map((m) => m.remote_id))
    const missing = LOCAL_CATEGORIES.filter((c) => !have.has(c.remoteId))
    if (!missing.length) return false
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO mailboxes (id, account_id, remote_id, name, path, role, type) VALUES (?, ?, ?, ?, ?, NULL, 'category')`
    )
    this.db.transaction(() => {
      for (const c of missing) ins.run(mailboxId(accountId, c.remoteId), accountId, c.remoteId, c.name, c.path)
    })()
    return true
  }

  setMailboxSync(id: string, state: unknown): void {
    this.db.prepare('UPDATE mailboxes SET sync_json = ? WHERE id = ?').run(JSON.stringify(state), id)
  }

  getMailboxSync<T>(id: string): T {
    const r = this.db.prepare('SELECT sync_json FROM mailboxes WHERE id = ?').get(id) as { sync_json: string } | undefined
    return JSON.parse(r?.sync_json ?? '{}') as T
  }

  // ---------- messages ----------
  private upsertStmt?: Database.Statement
  /**
   * `keepLocalCategories` (IMAP): category labels are local-only, so keep the ones an existing row already has
   * instead of replacing them with the server's folder list.
   */
  upsertMessages(accountId: string, list: MessageUpsert[], opts: { keepLocalCategories?: boolean } = {}): number[] {
    this.upsertStmt ??= this.db.prepare(
      `INSERT INTO messages (account_id, remote_id, thread_id, subject, from_name, from_email, to_json, cc_json,
         reply_to_json, snippet, date, is_read, is_starred, has_attachments, attachments_json, message_id_header,
         in_reply_to, refs, size)
       VALUES (@account_id, @remote_id, @thread_id, @subject, @from_name, @from_email, @to_json, @cc_json,
         @reply_to_json, @snippet, @date, @is_read, @is_starred, @has_attachments, @attachments_json,
         @message_id_header, @in_reply_to, @refs, @size)
       ON CONFLICT(account_id, remote_id) DO UPDATE SET
         thread_id = excluded.thread_id, subject = excluded.subject, from_name = excluded.from_name,
         from_email = excluded.from_email, to_json = excluded.to_json, cc_json = excluded.cc_json,
         reply_to_json = excluded.reply_to_json,
         snippet = CASE WHEN excluded.snippet != '' THEN excluded.snippet ELSE messages.snippet END,
         date = excluded.date, is_read = excluded.is_read, is_starred = excluded.is_starred,
         has_attachments = MAX(excluded.has_attachments, messages.has_attachments),
         attachments_json = CASE WHEN excluded.attachments_json != '[]' THEN excluded.attachments_json ELSE messages.attachments_json END,
         message_id_header = excluded.message_id_header, in_reply_to = excluded.in_reply_to, refs = excluded.refs,
         size = excluded.size
       RETURNING id`
    )
    const ftsInsert = this.db.prepare(
      'INSERT INTO messages_fts (rowid, subject, sender, recipients, snippet, body) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const ftsHas = this.db.prepare('SELECT 1 FROM messages_fts WHERE rowid = ?')
    const catsOf = this.db.prepare(
      `SELECT l.mailbox_id FROM messages m JOIN message_labels l ON l.message_id = m.id
       WHERE m.account_id = ? AND m.remote_id = ? AND l.mailbox_id LIKE ? ESCAPE '\\'`
    )
    const catPattern = `${accountId.replace(/[\\%_]/g, (c) => `\\${c}`)}:CATEGORY\\_%`
    const ids: number[] = []
    this.db.transaction(() => {
      for (const msg of list) {
        const keptCats = opts.keepLocalCategories
          ? (catsOf.all(accountId, msg.remoteId, catPattern) as { mailbox_id: string }[]).map((r) => r.mailbox_id)
          : []
        const row = this.upsertStmt!.get({
          account_id: accountId,
          remote_id: msg.remoteId,
          thread_id: msg.threadId,
          subject: msg.subject,
          from_name: msg.from.name,
          from_email: msg.from.email,
          to_json: JSON.stringify(msg.to),
          cc_json: JSON.stringify(msg.cc),
          reply_to_json: JSON.stringify(msg.replyTo),
          snippet: msg.snippet,
          date: msg.date,
          is_read: msg.isRead ? 1 : 0,
          is_starred: msg.isStarred ? 1 : 0,
          has_attachments: msg.hasAttachments ? 1 : 0,
          attachments_json: JSON.stringify(msg.attachments),
          message_id_header: msg.messageIdHeader,
          in_reply_to: msg.inReplyTo,
          refs: msg.references,
          size: msg.size
        }) as { id: number }
        ids.push(row.id)
        this.setLabelsRaw(row.id, keptCats.length ? [...new Set([...msg.mailboxIds, ...keptCats])] : msg.mailboxIds)
        if (!ftsHas.get(row.id)) {
          ftsInsert.run(
            row.id,
            msg.subject,
            `${msg.from.name} ${msg.from.email}`,
            [...msg.to, ...msg.cc].map((a) => `${a.name} ${a.email}`).join(' '),
            msg.snippet,
            ''
          )
        }
      }
    })()
    return ids
  }

  private setLabelsRaw(id: number, mailboxIds: string[]): void {
    this.db.prepare('DELETE FROM message_labels WHERE message_id = ?').run(id)
    const ins = this.db.prepare('INSERT OR IGNORE INTO message_labels (message_id, mailbox_id) VALUES (?, ?)')
    for (const mb of mailboxIds) ins.run(id, mb)
  }

  /** Set label membership for messages identified by remote id (used by sync). */
  updateRemoteState(
    accountId: string,
    updates: { remoteId: string; isRead?: boolean; isStarred?: boolean; mailboxIds?: string[] }[]
  ): void {
    const find = this.db.prepare('SELECT id FROM messages WHERE account_id = ? AND remote_id = ?')
    this.db.transaction(() => {
      for (const u of updates) {
        const r = find.get(accountId, u.remoteId) as { id: number } | undefined
        if (!r) continue
        if (u.isRead !== undefined) this.db.prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(u.isRead ? 1 : 0, r.id)
        if (u.isStarred !== undefined)
          this.db.prepare('UPDATE messages SET is_starred = ? WHERE id = ?').run(u.isStarred ? 1 : 0, r.id)
        if (u.mailboxIds) this.setLabelsRaw(r.id, u.mailboxIds)
      }
    })()
  }

  deleteByRemoteIds(accountId: string, remoteIds: string[]): number {
    if (!remoteIds.length) return 0
    const find = this.db.prepare('SELECT id FROM messages WHERE account_id = ? AND remote_id = ?')
    let n = 0
    this.db.transaction(() => {
      for (const rid of remoteIds) {
        const r = find.get(accountId, rid) as { id: number } | undefined
        if (!r) continue
        this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(r.id)
        this.db.prepare('DELETE FROM messages WHERE id = ?').run(r.id)
        n++
      }
    })()
    return n
  }

  /** Messages that belong to a mailbox (remote ids). */
  remoteIdsInMailbox(mailboxIdFull: string): string[] {
    return (
      this.db
        .prepare('SELECT m.remote_id FROM messages m JOIN message_labels l ON l.message_id = m.id WHERE l.mailbox_id = ?')
        .all(mailboxIdFull) as { remote_id: string }[]
    ).map((r) => r.remote_id)
  }

  existingRemoteIds(accountId: string, remoteIds: string[]): Set<string> {
    const out = new Set<string>()
    const stmt = this.db.prepare('SELECT 1 FROM messages WHERE account_id = ? AND remote_id = ?')
    for (const id of remoteIds) if (stmt.get(accountId, id)) out.add(id)
    return out
  }

  idsByRemote(accountId: string, remoteIds: string[]): number[] {
    const stmt = this.db.prepare('SELECT id FROM messages WHERE account_id = ? AND remote_id = ?')
    const out: number[] = []
    for (const rid of remoteIds) {
      const r = stmt.get(accountId, rid) as { id: number } | undefined
      if (r) out.push(r.id)
    }
    return out
  }

  refs(ids: number[]): LocalMessageRef[] {
    if (!ids.length) return []
    const rows = this.db
      .prepare(
        `SELECT id, account_id, remote_id, thread_id, attachments_json FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`
      )
      .all(...ids) as { id: number; account_id: string; remote_id: string; thread_id: string; attachments_json: string }[]
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      remoteId: r.remote_id,
      threadId: r.thread_id,
      attachments: JSON.parse(r.attachments_json)
    }))
  }

  ref(id: number): LocalMessageRef | undefined {
    return this.refs([id])[0]
  }

  /** Message ids in the same thread(s) as the given ids. */
  threadMessageIds(id: number): number[] {
    return (
      this.db
        .prepare(
          `SELECT m2.id FROM messages m JOIN messages m2 ON m2.account_id = m.account_id AND m2.thread_id = m.thread_id
           WHERE m.id = ?`
        )
        .all(id) as { id: number }[]
    ).map((r) => r.id)
  }

  states(ids: number[]): MessageState[] {
    if (!ids.length) return []
    const q = ids.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT id, is_read, is_starred FROM messages WHERE id IN (${q})`).all(...ids) as {
      id: number
      is_read: number
      is_starred: number
    }[]
    const labels = this.db.prepare(`SELECT message_id, mailbox_id FROM message_labels WHERE message_id IN (${q})`).all(...ids) as {
      message_id: number
      mailbox_id: string
    }[]
    const byId = new Map<number, string[]>()
    for (const l of labels) {
      const arr = byId.get(l.message_id) ?? []
      arr.push(l.mailbox_id)
      byId.set(l.message_id, arr)
    }
    return rows.map((r) => ({ id: r.id, isRead: !!r.is_read, isStarred: !!r.is_starred, labels: byId.get(r.id) ?? [] }))
  }

  applyStates(states: MessageState[]): void {
    const upd = this.db.prepare('UPDATE messages SET is_read = ?, is_starred = ? WHERE id = ?')
    this.db.transaction(() => {
      for (const s of states) {
        upd.run(s.isRead ? 1 : 0, s.isStarred ? 1 : 0, s.id)
        this.setLabelsRaw(s.id, s.labels)
      }
    })()
  }

  /** After an IMAP move with UIDPLUS: rewrite remote ids. */
  renameRemote(accountId: string, from: string, to: string): void {
    this.db.prepare('UPDATE OR REPLACE messages SET remote_id = ? WHERE account_id = ? AND remote_id = ?').run(to, accountId, from)
  }

  // ---------- list / views ----------
  private viewFilter(view: View): { where: string; params: unknown[] } {
    const conds: string[] = []
    const params: unknown[] = []
    if (view.accountId) {
      conds.push('m.account_id = ?')
      params.push(view.accountId)
    }
    if (view.kind === 'role') {
      switch (view.role) {
        case 'starred':
          conds.push('m.is_starred = 1', NOT_TRASH)
          break
        case 'all':
          conds.push(NOT_TRASH)
          break
        case 'trash':
          conds.push(hasRole('trash'))
          break
        case 'junk':
          // a message being trashed may still carry SPAM until the server confirms
          conds.push(hasRole('junk'), `NOT ${hasRole('trash')}`)
          break
        default:
          conds.push(hasRole(view.role), NOT_TRASH)
      }
      if (view.role === 'inbox' && view.category) {
        const catExists = (ids: string[]): string =>
          `EXISTS (SELECT 1 FROM message_labels cl JOIN mailboxes cb ON cb.id = cl.mailbox_id
             WHERE cl.message_id = m.id AND cb.remote_id IN (${ids.map((i) => `'${i}'`).join(',')}))`
        if (view.category === 'primary') conds.push(`NOT ${catExists(CATEGORY_IDS)}`)
        else conds.push(catExists([`CATEGORY_${view.category.toUpperCase()}`]))
      }
    } else if (view.kind === 'label') {
      conds.push('EXISTS (SELECT 1 FROM message_labels ll WHERE ll.message_id = m.id AND ll.mailbox_id = ?)', NOT_TRASH)
      params.push(view.mailboxId)
    } else {
      const fts = buildFtsQuery(view.query)
      const hits = view.token ? [...(this.remoteSearchHits.get(view.token) ?? [])] : []
      const alts: string[] = []
      if (fts.match) {
        alts.push('m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)')
        params.push(fts.match)
      }
      if (hits.length) alts.push(`m.id IN (${hits.join(',')})`)
      if (alts.length) conds.push(`(${alts.join(' OR ')})`)
      else if (!fts.unread && !fts.attachment && !fts.starred) conds.push('0')
      if (fts.unread) conds.push('m.is_read = 0')
      if (fts.starred) conds.push('m.is_starred = 1')
      if (fts.attachment) conds.push('m.has_attachments = 1')
      conds.push(NOT_TRASH)
    }
    return { where: conds.length ? conds.join(' AND ') : '1', params }
  }

  listThreads(view: View, offset: number, limit: number): { rows: ThreadRow[]; hasMore: boolean } {
    const { where, params } = this.viewFilter(view)
    let groups: {
      account_id: string
      thread_id: string
      maxdate: number
      cnt: number
      all_read: number
      any_star: number
      any_att: number
      rep_id: number
    }[]
    try {
      groups = this.db
        .prepare(
          `WITH f AS (SELECT m.id, m.account_id, m.thread_id, m.date, m.is_read, m.is_starred, m.has_attachments
                      FROM messages m WHERE ${where}),
           g AS (SELECT account_id, thread_id, MAX(date) AS maxdate, COUNT(*) AS cnt, MIN(is_read) AS all_read,
                        MAX(is_starred) AS any_star, MAX(has_attachments) AS any_att
                 FROM f GROUP BY account_id, thread_id ${view.unreadOnly ? 'HAVING MIN(is_read) = 0' : ''}
                 ORDER BY maxdate DESC LIMIT ? OFFSET ?)
           SELECT g.*, (SELECT f.id FROM f WHERE f.account_id = g.account_id AND f.thread_id = g.thread_id
                        ORDER BY f.date DESC, f.id DESC LIMIT 1) AS rep_id
           FROM g ORDER BY maxdate DESC`
        )
        .all(...params, limit + 1, offset) as typeof groups
    } catch (e) {
      // malformed FTS expression etc.
      console.warn('[repo] list query failed', (e as Error).message)
      return { rows: [], hasMore: false }
    }
    const hasMore = groups.length > limit
    groups = groups.slice(0, limit)
    if (!groups.length) return { rows: [], hasMore }

    const repIds = groups.map((g) => g.rep_id)
    const q = repIds.map(() => '?').join(',')
    const msgs = new Map<number, MessageRowDb>()
    for (const r of this.db.prepare(`SELECT * FROM messages WHERE id IN (${q})`).all(...repIds) as MessageRowDb[]) msgs.set(r.id, r)
    const labelRows = this.db
      .prepare(
        `SELECT l.message_id, l.mailbox_id FROM message_labels l JOIN mailboxes b ON b.id = l.mailbox_id
         WHERE l.message_id IN (${q}) AND b.type = 'user'`
      )
      .all(...repIds) as { message_id: number; mailbox_id: string }[]
    const labels = new Map<number, string[]>()
    for (const l of labelRows) labels.set(l.message_id, [...(labels.get(l.message_id) ?? []), l.mailbox_id])

    // participants: senders across the whole thread (within the view)
    const senders = this.db
      .prepare(
        `SELECT m.account_id, m.thread_id, m.from_name, m.from_email, m.is_read FROM messages m
         WHERE ${where} AND (m.account_id || char(1) || m.thread_id) IN (${groups.map(() => '?').join(',')})
         ORDER BY m.date ASC`
      )
      .all(...params, ...groups.map((g) => `${g.account_id}\u0001${g.thread_id}`)) as {
      account_id: string
      thread_id: string
      from_name: string
      from_email: string
    }[]
    const accountEmails = new Map(this.listAccounts().map((a) => [a.id, a.email.toLowerCase()]))
    const parts = new Map<string, string[]>()
    for (const s of senders) {
      const key = `${s.account_id}\u0001${s.thread_id}`
      const arr = parts.get(key) ?? []
      const me = accountEmails.get(s.account_id) === s.from_email.toLowerCase()
      const nm = me ? '나' : s.from_name.split(/\s+/)[0] || s.from_email.split('@')[0]
      if (!arr.includes(nm)) arr.push(nm)
      parts.set(key, arr)
    }

    const rows: ThreadRow[] = []
    for (const g of groups) {
      const m = msgs.get(g.rep_id)
      if (!m) continue
      const ps = parts.get(`${g.account_id}\u0001${g.thread_id}`) ?? []
      rows.push({
        id: m.id,
        accountId: m.account_id,
        threadId: m.thread_id,
        subject: m.subject,
        from: { name: m.from_name, email: m.from_email },
        participants: ps.length > 3 ? `${ps[0]} .. ${ps.slice(-2).join(', ')}` : ps.join(', '),
        snippet: m.snippet,
        date: g.maxdate,
        unread: !g.all_read,
        starred: !!g.any_star,
        hasAttachments: !!g.any_att,
        attachments: (JSON.parse(m.attachments_json) as AttachmentInfo[]).filter((a) => !a.inline),
        count: g.cnt,
        labelIds: labels.get(m.id) ?? []
      })
    }
    return { rows, hasMore }
  }

  countInView(view: View): number {
    const { where, params } = this.viewFilter(view)
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM messages m WHERE ${where}`).get(...params) as { c: number }).c
  }

  thread(messageId: number): MessageMeta[] {
    const base = this.db.prepare('SELECT account_id, thread_id FROM messages WHERE id = ?').get(messageId) as
      | { account_id: string; thread_id: string }
      | undefined
    if (!base) return []
    const inTrash = this.db
      .prepare(
        `SELECT 1 FROM message_labels l JOIN mailboxes b ON b.id = l.mailbox_id WHERE l.message_id = ? AND b.role IN ('trash','junk')`
      )
      .get(messageId)
    const rows = this.db
      .prepare(
        `SELECT * FROM messages m WHERE account_id = ? AND thread_id = ? ${inTrash ? '' : `AND (${NOT_TRASH} OR m.id = ?)`}
         ORDER BY date ASC, id ASC`
      )
      .all(...(inTrash ? [base.account_id, base.thread_id] : [base.account_id, base.thread_id, messageId])) as MessageRowDb[]
    const states = new Map(this.states(rows.map((r) => r.id)).map((s) => [s.id, s.labels]))
    return rows.map((r) => toMeta(r, states.get(r.id) ?? []))
  }

  meta(id: number): MessageMeta | undefined {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRowDb | undefined
    if (!r) return undefined
    return toMeta(r, this.states([id])[0]?.labels ?? [])
  }

  /** Of the given ids: unread messages that are (still) in an inbox and not in trash/spam, newest first. */
  notifiableIds(ids: number[]): number[] {
    if (!ids.length) return []
    return (
      this.db
        .prepare(
          `SELECT m.id FROM messages m WHERE m.id IN (${ids.map(() => '?').join(',')})
           AND m.is_read = 0 AND ${hasRole('inbox')} AND ${NOT_TRASH} ORDER BY m.date DESC`
        )
        .all(...ids) as { id: number }[]
    ).map((r) => r.id)
  }

  /** Latest inbox message ids (newest first), optionally for one account. */
  recentInboxIds(limit: number, accountId?: string | null): number[] {
    return (
      this.db
        .prepare(
          `SELECT m.id FROM messages m WHERE ${accountId ? 'm.account_id = ? AND' : ''} ${hasRole('inbox')} AND ${NOT_TRASH}
           ORDER BY m.date DESC LIMIT ?`
        )
        .all(...(accountId ? [accountId, limit] : [limit])) as { id: number }[]
    ).map((r) => r.id)
  }

  ruleSamples(limit: number): RuleSampleMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.account_id, m.subject, m.from_name, m.from_email, m.date FROM messages m
         WHERE ${hasRole('inbox')} AND ${NOT_TRASH} ORDER BY m.date DESC LIMIT ?`
      )
      .all(limit) as { id: number; account_id: string; subject: string; from_name: string; from_email: string; date: number }[]
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      subject: r.subject,
      from: { name: r.from_name, email: r.from_email },
      date: r.date
    }))
  }

  // ---------- rules ----------
  listRules(): Rule[] {
    return (this.db.prepare('SELECT * FROM rules ORDER BY sort, created_at').all() as RuleRow[]).map(toRule)
  }

  rule(id: string): Rule | undefined {
    const r = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined
    return r ? toRule(r) : undefined
  }

  upsertRule(r: { id: string; name: string; enabled: boolean; language: RuleLanguage; code: string; accountId: string | null }): void {
    const exists = this.db.prepare('SELECT 1 FROM rules WHERE id = ?').get(r.id)
    if (exists) {
      this.db
        .prepare('UPDATE rules SET name = ?, enabled = ?, language = ?, code = ?, account_id = ?, last_error = NULL WHERE id = ?')
        .run(r.name, r.enabled ? 1 : 0, r.language, r.code, r.accountId, r.id)
    } else {
      this.db
        .prepare(
          `INSERT INTO rules (id, name, enabled, language, code, account_id, sort, created_at)
           VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM rules), ?)`
        )
        .run(r.id, r.name, r.enabled ? 1 : 0, r.language, r.code, r.accountId, Date.now())
    }
  }

  deleteRule(id: string): void {
    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id)
  }

  reorderRules(ids: string[]): void {
    const upd = this.db.prepare('UPDATE rules SET sort = ? WHERE id = ?')
    this.db.transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))()
  }

  recordRuleRun(id: string, run: { error: string | null; hits: number }): void {
    this.db
      .prepare('UPDATE rules SET last_error = ?, last_run_at = ?, hit_count = hit_count + ? WHERE id = ?')
      .run(run.error, Date.now(), run.hits, id)
  }

  unreadInboxTotal(): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(DISTINCT m.account_id || char(1) || m.thread_id) AS c FROM messages m
           WHERE m.is_read = 0 AND ${hasRole('inbox')} AND ${NOT_TRASH}`
        )
        .get() as { c: number }
    ).c
  }

  // ---------- bodies ----------
  getBody(id: number): MessageBody | null {
    const r = this.db.prepare('SELECT html, text, attachments_json FROM bodies WHERE message_id = ?').get(id) as
      | { html: string | null; text: string | null; attachments_json: string }
      | undefined
    if (!r) return null
    return { html: r.html, text: r.text, attachments: JSON.parse(r.attachments_json) }
  }

  hasBody(id: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM bodies WHERE message_id = ?').get(id)
  }

  putBody(id: number, body: MessageBody, plainForIndex: string, snippet?: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO bodies (message_id, html, text, attachments_json, fetched_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, body.html, body.text, JSON.stringify(body.attachments), Date.now())
      const visible = body.attachments.filter((a) => !a.inline)
      if (visible.length) {
        this.db
          .prepare('UPDATE messages SET attachments_json = ?, has_attachments = 1 WHERE id = ?')
          .run(JSON.stringify(visible), id)
      }
      if (snippet) this.db.prepare(`UPDATE messages SET snippet = ? WHERE id = ? AND snippet = ''`).run(snippet, id)
      this.db.prepare('UPDATE messages_fts SET body = ? WHERE rowid = ?').run(plainForIndex.slice(0, 20000), id)
    })()
  }
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function toMeta(r: MessageRowDb, labels: string[]): MessageMeta {
  return {
    id: r.id,
    accountId: r.account_id,
    remoteId: r.remote_id,
    threadId: r.thread_id,
    subject: r.subject,
    from: { name: r.from_name, email: r.from_email },
    to: parseJson(r.to_json, []),
    cc: parseJson(r.cc_json, []),
    replyTo: parseJson(r.reply_to_json, []),
    date: r.date,
    snippet: r.snippet,
    unread: !r.is_read,
    starred: !!r.is_starred,
    hasAttachments: !!r.has_attachments,
    attachments: parseJson(r.attachments_json, []),
    messageIdHeader: r.message_id_header,
    inReplyTo: r.in_reply_to,
    references: r.refs,
    labelIds: labels
  }
}

function toRule(r: RuleRow): Rule {
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    language: r.language,
    code: r.code,
    accountId: r.account_id,
    sort: r.sort,
    createdAt: r.created_at,
    lastError: r.last_error,
    lastRunAt: r.last_run_at,
    hitCount: r.hit_count
  }
}

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    provider: r.provider,
    preset: r.preset,
    email: r.email,
    name: r.name,
    color: r.color,
    oauthClientId: r.oauth_client_id,
    needsReauth: !!r.needs_reauth
  }
}
