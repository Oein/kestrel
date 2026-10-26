import { ImapFlow, type FetchMessageObject, type MailboxObject } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import nodemailer from 'nodemailer'
import type { AttachmentInfo, Draft, ImapServerConfig } from '../../../shared/types'
import type { LocalMessageRef, MailboxUpsert, MessageUpsert, Repo } from '../../db/repo'
import { mailboxId } from '../../db/repo'
import { htmlToText } from '../../mime'
import type { FetchedBody, MailProvider, SendEnvelope, StateChange, SyncOutcome } from '../types'
import {
  ROLE_NAMES,
  attachmentsFromStructure,
  decodeCharset,
  decodeTransfer,
  headerValue,
  makeSnippet,
  roleOf,
  snippetPart,
  threadKey
} from './util'

export interface ImapConfig {
  email: string
  name: string
  username: string
  imap: ImapServerConfig
  smtp: ImapServerConfig
  /** append sent messages to the Sent folder (servers like iCloud/Naver do this themselves) */
  appendSent: boolean
}

interface MailboxSyncState {
  uidValidity?: string
  uidNext?: number
  highestModseq?: string
  oldestUid?: number
  exists?: number
  exhausted?: boolean
}

const SEP = '\u0001'
export const imapRemoteId = (path: string, uid: number): string => `${path}${SEP}${uid}`
export const parseRemoteId = (rid: string): { path: string; uid: number } => {
  const i = rid.lastIndexOf(SEP)
  return { path: rid.slice(0, i), uid: Number(rid.slice(i + 1)) }
}

const INITIAL_INBOX = 200
const INITIAL_OTHER = 50
const MAX_FOLDERS = 30

function client(cfg: ImapConfig, password: string): ImapFlow {
  return new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.secure,
    auth: { user: cfg.username, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 5 * 60_000,
    qresync: true,
    clientInfo: { name: 'Kestrel', version: '0.1.0' }
  })
}

export async function testImap(cfg: ImapConfig, password: string): Promise<{ imap: string | null; smtp: string | null }> {
  let imapErr: string | null = null
  let smtpErr: string | null = null
  const c = client(cfg, password)
  c.on('error', () => {})
  try {
    await c.connect()
    await c.logout()
  } catch (e) {
    const err = e as Error & { authenticationFailed?: boolean; responseText?: string }
    imapErr = err.authenticationFailed ? '인증 실패: 사용자 이름 또는 (앱) 비밀번호를 확인하세요.' : (err.responseText ?? err.message)
  }
  try {
    const t = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.secure,
      requireTLS: !cfg.smtp.secure,
      auth: { user: cfg.username, pass: password },
      connectionTimeout: 15_000
    })
    await t.verify()
    t.close()
  } catch (e) {
    const err = e as Error & { code?: string }
    smtpErr = err.code === 'EAUTH' ? '인증 실패: 사용자 이름 또는 (앱) 비밀번호를 확인하세요.' : err.message
  }
  return { imap: imapErr, smtp: smtpErr }
}

export class ImapProvider implements MailProvider {
  readonly kind = 'imap' as const
  private ops: ImapFlow | null = null
  private opsConnecting: Promise<ImapFlow> | null = null
  private idleClient: ImapFlow | null = null
  private idleStopped = false
  private idleBackoff = 1000
  private onChange: (() => void) | null = null
  private pollTimer: NodeJS.Timeout | null = null

  constructor(
    readonly accountId: string,
    private repo: Repo,
    private cfg: ImapConfig,
    private password: () => string
  ) {}

  // ---------- connections ----------
  private async conn(): Promise<ImapFlow> {
    if (this.ops?.usable) return this.ops
    this.opsConnecting ??= (async () => {
      try {
        const c = client(this.cfg, this.password())
        c.on('error', (e: Error) => console.warn(`[imap ${this.accountId}] ops error`, e.message))
        c.on('close', () => {
          if (this.ops === c) this.ops = null
        })
        await c.connect()
        this.ops = c
        return c
      } finally {
        this.opsConnecting = null
      }
    })()
    return this.opsConnecting
  }

  async connect(): Promise<void> {
    await this.conn()
  }

  async close(): Promise<void> {
    this.idleStopped = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    const cs = [this.ops, this.idleClient]
    this.ops = this.idleClient = null
    await Promise.all(cs.map((c) => c?.logout().catch(() => c.close())))
  }

  private async withMailbox<T>(path: string, fn: (c: ImapFlow, mb: MailboxObject) => Promise<T>): Promise<T> {
    const c = await this.conn()
    const lock = await c.getMailboxLock(path)
    try {
      return await fn(c, c.mailbox as MailboxObject)
    } finally {
      lock.release()
    }
  }

  // ---------- realtime ----------
  watch(onChange: () => void): void {
    this.onChange = onChange
    this.idleStopped = false
    void this.startIdle()
    // safety net for servers with flaky IDLE + flag changes in other folders
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(onChange, 2 * 60_000)
  }

  private async startIdle(): Promise<void> {
    if (this.idleStopped) return
    let c: ImapFlow
    try {
      c = client(this.cfg, this.password())
    } catch (e) {
      console.warn(`[imap ${this.accountId}] idle disabled:`, (e as Error).message)
      return
    }
    this.idleClient = c
    let debounce: NodeJS.Timeout | null = null
    const trigger = (): void => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => this.onChange?.(), 300)
    }
    c.on('exists', trigger)
    c.on('expunge', trigger)
    c.on('flags', trigger)
    c.on('error', (e: Error) => console.warn(`[imap ${this.accountId}] idle error`, e.message))
    c.on('close', () => {
      if (this.idleStopped || this.idleClient !== c) return
      const wait = this.idleBackoff
      this.idleBackoff = Math.min(this.idleBackoff * 2, 5 * 60_000)
      setTimeout(() => void this.startIdle(), wait)
    })
    try {
      await c.connect()
      await c.mailboxOpen('INBOX', { readOnly: true })
      this.idleBackoff = 1000
      // imapflow enters IDLE automatically when the connection is otherwise unused
    } catch (e) {
      console.warn(`[imap ${this.accountId}] idle connect failed`, (e as Error).message)
      c.close()
    }
  }

  // ---------- folders ----------
  async syncFolders(): Promise<void> {
    const c = await this.conn()
    const list = await c.list()
    const out: MailboxUpsert[] = []
    for (const f of list) {
      if (f.flags.has('\\Noselect') || f.flags.has('\\NonExistent')) continue
      const role = roleOf(f.path, f.name, f.specialUse)
      if (role === 'all' || f.specialUse === '\\Flagged') continue // virtual folders would duplicate messages
      out.push({
        remoteId: f.path,
        name: role ? ROLE_NAMES[role] : f.name,
        path: role ? ROLE_NAMES[role] : f.path.split(f.delimiter || '/').join('/'),
        role,
        type: role ? 'system' : 'user'
      })
    }
    // only one mailbox per role
    const seen = new Set<string>()
    const unique = out.filter((m) => {
      if (!m.role) return true
      if (seen.has(m.role)) {
        m.role = null
        m.type = 'user'
        m.name = m.remoteId
        m.path = m.remoteId
        return true
      }
      seen.add(m.role)
      return true
    })
    this.repo.replaceMailboxes(this.accountId, unique, { keepCategories: true })
  }

  /** Rules: folder for a label name (created on the server when missing). Returns the local mailbox id. */
  async ensureLabel(name: string): Promise<string> {
    const find = (): string | undefined => {
      const lower = name.toLowerCase()
      const mbs = this.repo.mailboxInfos(this.accountId).filter((m) => m.type !== 'category')
      return (mbs.find((m) => m.path.toLowerCase() === lower) ?? mbs.find((m) => m.remote_id.toLowerCase() === lower))?.id
    }
    const have = find()
    if (have) return have
    const c = await this.conn()
    await c.mailboxCreate(name.split('/').filter(Boolean))
    await this.syncFolders()
    const id = find()
    if (!id) throw new Error(`폴더를 만들지 못했습니다: ${name}`)
    return id
  }

  private syncedMailboxes(): { id: string; remote_id: string; role: string | null }[] {
    const all = this.repo.mailboxesOf(this.accountId)
    const order = ['inbox', 'sent', 'drafts', 'archive', 'trash', 'junk']
    const sys = all.filter((m) => m.role).sort((a, b) => order.indexOf(a.role!) - order.indexOf(b.role!))
    const user = all.filter((m) => !m.role).slice(0, MAX_FOLDERS)
    return [...sys, ...user]
  }

  // ---------- sync ----------
  async sync(): Promise<SyncOutcome> {
    if (!this.repo.mailboxesOf(this.accountId).length) await this.syncFolders()
    const newInbox: number[] = []
    let changed = false
    for (const mb of this.syncedMailboxes()) {
      try {
        const r = await this.syncMailbox(mb.id, mb.remote_id, mb.role === 'inbox')
        if (r.changed) changed = true
        if (mb.role === 'inbox') newInbox.push(...r.newIds)
      } catch (e) {
        console.warn(`[imap ${this.accountId}] sync ${mb.remote_id} failed`, (e as Error).message)
        if (mb.role === 'inbox') throw e
      }
    }
    return { newInboxIds: newInbox, changed }
  }

  private async syncMailbox(mbId: string, path: string, isInbox: boolean): Promise<{ changed: boolean; newIds: number[] }> {
    return this.withMailbox(path, async (c, box) => {
      let st = this.repo.getMailboxSync<MailboxSyncState>(mbId)
      const uidValidity = String(box.uidValidity)
      if (st.uidValidity && st.uidValidity !== uidValidity) {
        // UIDVALIDITY changed: cached UIDs are meaningless
        this.repo.deleteByRemoteIds(this.accountId, this.repo.remoteIdsInMailbox(mbId))
        st = {}
      }
      const modseq = box.highestModseq !== undefined ? String(box.highestModseq) : undefined
      const initial = st.uidNext === undefined
      if (!initial && st.uidNext === box.uidNext && st.exists === box.exists && (!modseq || modseq === st.highestModseq)) {
        return { changed: false, newIds: [] }
      }

      let newIds: number[] = []
      let oldestUid = st.oldestUid ?? 0
      if (initial) {
        if (box.exists > 0) {
          const n = isInbox ? INITIAL_INBOX : INITIAL_OTHER
          const from = Math.max(1, box.exists - n + 1)
          const msgs = await this.fetchEnvelopes(c, `${from}:*`, false)
          this.store(mbId, path, msgs)
          oldestUid = msgs.length ? Math.min(...msgs.map((m) => m.uid)) : 0
          await this.fillSnippets(c, path, msgs)
        }
      } else {
        // 1) new messages
        if (box.uidNext > (st.uidNext ?? 0)) {
          const msgs = (await this.fetchEnvelopes(c, `${st.uidNext}:*`, true)).filter((m) => m.uid >= (st.uidNext ?? 0))
          const ids = this.store(mbId, path, msgs)
          newIds = ids
          if (!oldestUid && msgs.length) oldestUid = Math.min(...msgs.map((m) => m.uid))
          await this.fillSnippets(c, path, msgs)
        }
        // 2) flag changes
        if (oldestUid) {
          const useCondstore = c.enabled.has('CONDSTORE') && st.highestModseq && modseq
          if (!useCondstore || modseq !== st.highestModseq) {
            const updates: { remoteId: string; isRead: boolean; isStarred: boolean }[] = []
            for await (const m of c.fetch(
              `${oldestUid}:*`,
              { uid: true, flags: true },
              { uid: true, ...(useCondstore ? { changedSince: BigInt(st.highestModseq!) } : {}) }
            )) {
              updates.push({
                remoteId: imapRemoteId(path, m.uid),
                isRead: !!m.flags?.has('\\Seen'),
                isStarred: !!m.flags?.has('\\Flagged')
              })
            }
            this.repo.updateRemoteState(this.accountId, updates)
          }
          // 3) deletions (expunged since last sync)
          const serverUids = await c.search({ uid: `${oldestUid}:*` }, { uid: true })
          if (Array.isArray(serverUids)) {
            const alive = new Set(serverUids.map((u) => imapRemoteId(path, u)))
            const gone = this.repo.remoteIdsInMailbox(mbId).filter((rid) => !alive.has(rid))
            this.repo.deleteByRemoteIds(this.accountId, gone)
          }
        }
      }
      this.repo.setMailboxSync(mbId, {
        ...st,
        uidValidity,
        uidNext: box.uidNext,
        exists: box.exists,
        highestModseq: modseq,
        oldestUid,
        exhausted: st.exhausted ?? (initial && box.exists <= (isInbox ? INITIAL_INBOX : INITIAL_OTHER))
      } satisfies MailboxSyncState)
      return { changed: true, newIds }
    })
  }

  private async fetchEnvelopes(c: ImapFlow, range: string, uid: boolean): Promise<FetchMessageObject[]> {
    const out: FetchMessageObject[] = []
    for await (const m of c.fetch(
      range,
      {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        size: true,
        headers: ['references', 'in-reply-to']
      },
      { uid }
    )) {
      out.push(m)
    }
    return out
  }

  private store(mbId: string, path: string, msgs: FetchMessageObject[]): number[] {
    const upserts: MessageUpsert[] = msgs.map((m) => {
      const env = m.envelope ?? {}
      const rid = imapRemoteId(path, m.uid)
      const refs = headerValue(m.headers, 'references')
      const irt = headerValue(m.headers, 'in-reply-to') ?? env.inReplyTo ?? null
      const atts = attachmentsFromStructure(m.bodyStructure)
      const addr = (l?: { name?: string; address?: string }[]): { name: string; email: string }[] =>
        (l ?? []).filter((a) => a.address).map((a) => ({ name: a.name ?? '', email: a.address! }))
      const date = env.date ? new Date(env.date) : m.internalDate ? new Date(m.internalDate) : new Date()
      return {
        remoteId: rid,
        threadId: threadKey(refs, irt, env.messageId ?? null, rid),
        subject: env.subject ?? '',
        from: addr(env.from)[0] ?? { name: '', email: '' },
        to: addr(env.to),
        cc: addr(env.cc),
        replyTo: addr(env.replyTo),
        snippet: '',
        date: isNaN(date.getTime()) ? Date.now() : date.getTime(),
        isRead: !!m.flags?.has('\\Seen'),
        isStarred: !!m.flags?.has('\\Flagged'),
        hasAttachments: atts.some((a) => !a.inline),
        attachments: atts.filter((a) => !a.inline),
        messageIdHeader: env.messageId ?? null,
        inReplyTo: irt,
        references: refs,
        size: m.size ?? 0,
        mailboxIds: [mbId]
      }
    })
    return this.repo.upsertMessages(this.accountId, upserts, { keepLocalCategories: true })
  }

  /** Fetch the first ~1KB of the text part of each message to build list snippets. */
  private async fillSnippets(c: ImapFlow, path: string, msgs: FetchMessageObject[]): Promise<void> {
    const byPart = new Map<string, FetchMessageObject[]>()
    for (const m of msgs.slice(-200)) {
      const p = snippetPart(m.bodyStructure)
      if (!p) continue
      const key = p.part ?? 'TEXT'
      byPart.set(key, [...(byPart.get(key) ?? []), m])
    }
    const updates: { id: number; snippet: string }[] = []
    for (const [key, list] of byPart) {
      const structByUid = new Map(list.map((m) => [m.uid, snippetPart(m.bodyStructure)!]))
      try {
        for await (const m of c.fetch(
          list.map((x) => x.uid).join(','),
          { uid: true, bodyParts: [{ key, start: 0, maxLength: 2048 }] },
          { uid: true }
        )) {
          const raw = m.bodyParts?.get(key) ?? [...(m.bodyParts?.values() ?? [])][0]
          const node = structByUid.get(m.uid)
          if (!raw || !node) continue
          const text = decodeCharset(decodeTransfer(raw, node.encoding), node.parameters?.charset)
          const snippet = makeSnippet(text, node.type === 'text/html')
          const id = this.repo.idsByRemote(this.accountId, [imapRemoteId(path, m.uid)])[0]
          if (id && snippet) updates.push({ id, snippet })
        }
      } catch (e) {
        console.warn(`[imap ${this.accountId}] snippet fetch failed`, (e as Error).message)
      }
    }
    const stmt = this.repo.db.prepare('UPDATE messages SET snippet = ? WHERE id = ?')
    const fts = this.repo.db.prepare('UPDATE messages_fts SET snippet = ? WHERE rowid = ?')
    this.repo.db.transaction(() => {
      for (const u of updates) {
        stmt.run(u.snippet, u.id)
        fts.run(u.snippet, u.id)
      }
    })()
  }

  async backfill(mbIdArg: string | null): Promise<number> {
    const mb = mbIdArg ? this.repo.mailboxRow(mbIdArg) : this.repo.mailboxByRole(this.accountId, 'inbox')
    if (!mb) return 0
    const mbId = mb.id
    const st = this.repo.getMailboxSync<MailboxSyncState>(mbId)
    if (st.exhausted || !st.oldestUid || st.oldestUid <= 1) return 0
    return this.withMailbox(mb.remote_id, async (c) => {
      const uids = await c.search({ uid: `1:${st.oldestUid! - 1}` }, { uid: true })
      if (!Array.isArray(uids) || !uids.length) {
        this.repo.setMailboxSync(mbId, { ...st, exhausted: true })
        return 0
      }
      const batch = uids.sort((a, b) => a - b).slice(-100)
      const msgs = await this.fetchEnvelopes(c, batch.join(','), true)
      this.store(mbId, mb.remote_id, msgs)
      await this.fillSnippets(c, mb.remote_id, msgs)
      this.repo.setMailboxSync(mbId, { ...st, oldestUid: batch[0], exhausted: uids.length <= 100 })
      return msgs.length
    })
  }

  async search(query: string): Promise<number[]> {
    const inbox = this.repo.mailboxByRole(this.accountId, 'inbox')
    if (!inbox) return []
    const mbId = inbox.id
    return this.withMailbox(inbox.remote_id, async (c) => {
      const uids = await c.search({ or: [{ subject: query }, { from: query }, { body: query }] }, { uid: true })
      if (!Array.isArray(uids) || !uids.length) return []
      const latest = uids.sort((a, b) => a - b).slice(-100)
      const rids = latest.map((u) => imapRemoteId(inbox.remote_id, u))
      const have = this.repo.existingRemoteIds(this.accountId, rids)
      const missing = latest.filter((u) => !have.has(imapRemoteId(inbox.remote_id, u)))
      if (missing.length) {
        const msgs = await this.fetchEnvelopes(c, missing.join(','), true)
        this.store(mbId, inbox.remote_id, msgs)
      }
      return this.repo.idsByRemote(this.accountId, rids)
    })
  }

  // ---------- bodies ----------
  private async parse(ref: LocalMessageRef): Promise<ParsedMail> {
    const { path, uid } = parseRemoteId(ref.remoteId)
    return this.withMailbox(path, async (c) => {
      const msg = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      if (!msg || !msg.source) throw new Error('메시지를 찾을 수 없습니다.')
      return simpleParser(msg.source, { skipImageLinks: true, skipTextLinks: true })
    })
  }

  async fetchBodies(refs: LocalMessageRef[]): Promise<Map<number, FetchedBody>> {
    const out = new Map<number, FetchedBody>()
    for (const ref of refs) {
      try {
        const p = await this.parse(ref)
        let html = typeof p.html === 'string' ? p.html : null
        const attachments: AttachmentInfo[] = []
        p.attachments.forEach((a, i) => {
          const cid = a.contentId?.replace(/[<>]/g, '') ?? null
          const inline = !!cid && !!html && html.includes(`cid:${cid}`)
          if (inline && html && a.size < 3_000_000) {
            html = html.split(`cid:${cid}`).join(`data:${a.contentType};base64,${a.content.toString('base64')}`)
          }
          const known = ref.attachments.find((k) => k.filename === a.filename)
          attachments.push({
            id: known?.id ?? `idx:${i}`,
            filename: a.filename ?? `첨부파일 ${i + 1}`,
            mimeType: a.contentType,
            size: a.size,
            contentId: cid,
            inline
          })
        })
        const text = p.text ?? null
        out.set(ref.id, {
          html,
          text,
          attachments,
          plain: text ?? (html ? htmlToText(html) : ''),
          snippet: makeSnippet(text ?? html ?? '', !text)
        })
      } catch (e) {
        console.warn(`[imap ${this.accountId}] body fetch failed`, (e as Error).message)
        if (refs.length === 1) throw e
      }
    }
    return out
  }

  async fetchAttachment(ref: LocalMessageRef, att: AttachmentInfo, onProgress?: (loaded: number) => void): Promise<Buffer> {
    if (att.id.startsWith('idx:')) {
      const p = await this.parse(ref)
      const a = p.attachments[Number(att.id.slice(4))]
      if (!a) throw new Error('첨부파일을 찾을 수 없습니다.')
      return a.content
    }
    const { path, uid } = parseRemoteId(ref.remoteId)
    return this.withMailbox(path, async (c) => {
      const dl = await c.download(String(uid), att.id, { uid: true })
      if (!('content' in dl) || !dl.content) throw new Error('첨부파일을 찾을 수 없습니다.')
      const chunks: Buffer[] = []
      let loaded = 0
      for await (const chunk of dl.content) {
        chunks.push(chunk as Buffer)
        loaded += (chunk as Buffer).length
        onProgress?.(loaded)
      }
      return Buffer.concat(chunks)
    })
  }

  // ---------- mutations ----------
  async applyChanges(changes: StateChange[]): Promise<void> {
    const strip = (id: string): string => id.slice(this.accountId.length + 1)
    // group by folder
    const byPath = new Map<string, StateChange[]>()
    for (const ch of changes) {
      const { path } = parseRemoteId(ch.ref.remoteId)
      byPath.set(path, [...(byPath.get(path) ?? []), ch])
    }
    for (const [path, list] of byPath) {
      await this.withMailbox(path, async (c) => {
        const flagOps: [string, boolean, number[]][] = []
        const add = (flag: string, value: boolean, uid: number): void => {
          const g = flagOps.find(([f, v]) => f === flag && v === value)
          if (g) g[2].push(uid)
          else flagOps.push([flag, value, [uid]])
        }
        const moves = new Map<string, StateChange[]>()
        for (const ch of list) {
          const { uid } = parseRemoteId(ch.ref.remoteId)
          if (ch.before.isRead !== ch.after.isRead) add('\\Seen', ch.after.isRead, uid)
          if (ch.before.isStarred !== ch.after.isStarred) add('\\Flagged', ch.after.isStarred, uid)
          // category labels are local-only; the folder is the first other label
          const folder = (labels: string[]): string | undefined => labels.find((l) => !strip(l).startsWith('CATEGORY_'))
          const dest = folder(ch.after.labels)
          if (dest && dest !== folder(ch.before.labels)) {
            const p = strip(dest)
            moves.set(p, [...(moves.get(p) ?? []), ch])
          }
        }
        for (const [flag, value, uids] of flagOps) {
          const range = uids.join(',')
          if (value) await c.messageFlagsAdd(range, [flag], { uid: true })
          else await c.messageFlagsRemove(range, [flag], { uid: true })
        }
        for (const [dest, chs] of moves) {
          const uids = chs.map((ch) => parseRemoteId(ch.ref.remoteId).uid)
          const res = await c.messageMove(uids.join(','), dest, { uid: true })
          if (!res) throw new Error('메시지를 이동하지 못했습니다.')
          for (const ch of chs) {
            const oldUid = parseRemoteId(ch.ref.remoteId).uid
            const newUid = res.uidMap?.get(oldUid)
            if (newUid) this.repo.renameRemote(this.accountId, ch.ref.remoteId, imapRemoteId(dest, newUid))
            // without UIDPLUS the destination folder sync will pick it up; drop the stale row
            else this.repo.deleteByRemoteIds(this.accountId, [ch.ref.remoteId])
          }
        }
      })
    }
  }

  async send(raw: Buffer, _draft: Draft, envelope: SendEnvelope): Promise<void> {
    const t = nodemailer.createTransport({
      host: this.cfg.smtp.host,
      port: this.cfg.smtp.port,
      secure: this.cfg.smtp.secure,
      requireTLS: !this.cfg.smtp.secure,
      auth: { user: this.cfg.username, pass: this.password() }
    })
    try {
      await t.sendMail({ envelope: { from: envelope.from, to: envelope.to }, raw })
    } finally {
      t.close()
    }
    if (this.cfg.appendSent) {
      const sent = this.repo.mailboxByRole(this.accountId, 'sent')
      if (sent) {
        const c = await this.conn()
        await c.append(sent.remote_id, raw, ['\\Seen']).catch((e: Error) => console.warn('[imap] append sent failed', e.message))
      }
    }
    // pick up the sent copy soon
    setTimeout(() => this.onChange?.(), 2000)
  }

  mailboxIdFor(path: string): string {
    return mailboxId(this.accountId, path)
  }
}
