import type { AttachmentInfo, Draft, MailboxRole } from '../../../shared/types'
import type { LocalMessageRef, MailboxUpsert, Repo } from '../../db/repo'
import { mailboxId } from '../../db/repo'
import { fromBase64Url, toBase64Url } from '../../mime'
import type { FetchedBody, MailProvider, StateChange, SyncOutcome } from '../types'
import { GmailApi, GmailHttpError, type GmailAuthSource } from './api'
import type { BatchRequest } from './batch'
import { reduceHistory, type HistoryRecord } from './history'
import { extractBody, METADATA_HEADERS, plainOf, toUpsert, type GmailMessage } from './parse'

interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
  color?: { backgroundColor?: string; textColor?: string }
  labelListVisibility?: string
}

interface AccountSyncState {
  historyId?: string
  initialDone?: boolean
}

interface MailboxSyncState {
  nextPageToken?: string | null
  exhausted?: boolean
}

const SYSTEM_ROLES: Record<string, { role: MailboxRole | null; name: string; type: 'system' | 'category' }> = {
  INBOX: { role: 'inbox', name: '받은편지함', type: 'system' },
  SENT: { role: 'sent', name: '보낸편지함', type: 'system' },
  DRAFT: { role: 'drafts', name: '임시보관함', type: 'system' },
  TRASH: { role: 'trash', name: '휴지통', type: 'system' },
  SPAM: { role: 'junk', name: '스팸', type: 'system' },
  STARRED: { role: 'starred', name: '별표편지함', type: 'system' },
  IMPORTANT: { role: 'important', name: '중요', type: 'system' },
  CATEGORY_PERSONAL: { role: null, name: '기본', type: 'category' },
  CATEGORY_SOCIAL: { role: null, name: '소셜', type: 'category' },
  CATEGORY_PROMOTIONS: { role: null, name: '프로모션', type: 'category' },
  CATEGORY_UPDATES: { role: null, name: '업데이트', type: 'category' },
  CATEGORY_FORUMS: { role: null, name: '포럼', type: 'category' }
}

const metaPath = (id: string): string =>
  `/gmail/v1/users/me/messages/${id}?format=metadata&${METADATA_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&')}`

export class GmailApiProvider implements MailProvider {
  readonly kind = 'gmail' as const
  readonly api: GmailApi
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly accountId: string,
    private repo: Repo,
    auth: GmailAuthSource
  ) {
    this.api = new GmailApi(auth)
  }

  async connect(): Promise<void> {
    await this.api.token()
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  watch(onChange: () => void): void {
    if (this.timer) clearInterval(this.timer)
    // history.list is cheap (2 quota units) — poll every 15s while the app is open
    this.timer = setInterval(onChange, 15_000)
  }

  async syncFolders(): Promise<void> {
    const res = await this.api.request<{ labels: GmailLabel[] }>('GET', '/gmail/v1/users/me/labels')
    const list: MailboxUpsert[] = []
    for (const l of res.labels ?? []) {
      if (l.type === 'system') {
        const sys = SYSTEM_ROLES[l.id]
        if (!sys) continue
        list.push({ remoteId: l.id, name: sys.name, path: sys.name, role: sys.role, type: sys.type })
      } else {
        list.push({
          remoteId: l.id,
          name: l.name.split('/').pop() ?? l.name,
          path: l.name,
          role: null,
          type: 'user',
          colorBg: l.color?.backgroundColor ?? null,
          colorText: l.color?.textColor ?? null
        })
      }
    }
    this.repo.replaceMailboxes(this.accountId, list)
  }

  /** Rules: label id for a (full) label name, creating a user label when missing. */
  async ensureLabel(name: string): Promise<string> {
    const find = (): string | undefined => {
      const lower = name.toLowerCase()
      return this.repo.mailboxInfos(this.accountId).find((m) => m.type === 'user' && m.path.toLowerCase() === lower)?.id
    }
    const have = find()
    if (have) return have
    try {
      const created = await this.api.request<GmailLabel>('POST', '/gmail/v1/users/me/labels', {
        body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }
      })
      await this.syncFolders()
      return find() ?? mailboxId(this.accountId, created.id)
    } catch (e) {
      // 409: created meanwhile (e.g. in another client) → refresh and look again
      if (!(e instanceof GmailHttpError && e.status === 409)) throw e
      await this.syncFolders()
      const id = find()
      if (!id) throw e
      return id
    }
  }

  // ---------- sync ----------
  async sync(): Promise<SyncOutcome> {
    const state = this.repo.getAccountSync<AccountSyncState>(this.accountId)
    if (!state.historyId || !state.initialDone) return this.initialSync()
    try {
      return await this.incrementalSync(state.historyId)
    } catch (e) {
      if (e instanceof GmailHttpError && e.status === 404) {
        // historyId too old → full resync
        console.warn('[gmail] history expired, full resync')
        return this.initialSync()
      }
      throw e
    }
  }

  private async initialSync(): Promise<SyncOutcome> {
    const profile = await this.api.request<{ historyId: string }>('GET', '/gmail/v1/users/me/profile')
    await this.syncFolders()
    const [inbox, all] = await Promise.all([
      this.api.request<{ messages?: { id: string }[]; nextPageToken?: string }>('GET', '/gmail/v1/users/me/messages', {
        query: { labelIds: 'INBOX', maxResults: 100 }
      }),
      this.api.request<{ messages?: { id: string }[] }>('GET', '/gmail/v1/users/me/messages', {
        query: { maxResults: 100 }
      })
    ])
    const ids = [...new Set([...(inbox.messages ?? []), ...(all.messages ?? [])].map((m) => m.id))]
    // inbox first so the UI fills top-down quickly
    await this.fetchMetadata(ids)
    const inboxMb = mailboxId(this.accountId, 'INBOX')
    this.repo.setMailboxSync(inboxMb, { nextPageToken: inbox.nextPageToken ?? null, exhausted: !inbox.nextPageToken })
    this.repo.setAccountSync(this.accountId, { historyId: profile.historyId, initialDone: true })
    return { newInboxIds: [], changed: true }
  }

  private async incrementalSync(startHistoryId: string): Promise<SyncOutcome> {
    const records: HistoryRecord[] = []
    let pageToken: string | undefined
    let latest = startHistoryId
    do {
      const res = await this.api.request<{ history?: HistoryRecord[]; nextPageToken?: string; historyId: string }>(
        'GET',
        '/gmail/v1/users/me/history',
        {
          query: {
            startHistoryId,
            pageToken,
            maxResults: 500,
            historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
          }
        }
      )
      records.push(...(res.history ?? []))
      pageToken = res.nextPageToken
      latest = res.historyId ?? latest
    } while (pageToken)

    if (!records.length) {
      if (latest !== startHistoryId) this.repo.setAccountSync(this.accountId, { historyId: latest, initialDone: true })
      return { newInboxIds: [], changed: false }
    }
    const cs = reduceHistory(records)
    this.repo.deleteByRemoteIds(this.accountId, cs.deleted)
    const existing = this.repo.existingRemoteIds(this.accountId, cs.relabeled)
    // relabeled messages we never cached: treat as new (e.g. moved back into the inbox)
    const toFetch = [...cs.added, ...cs.relabeled.filter((id) => !existing.has(id))]
    await this.fetchMetadata(toFetch)
    await this.refreshLabels([...existing])
    this.repo.setAccountSync(this.accountId, { historyId: latest, initialDone: true })
    const newIds = this.repo.idsByRemote(this.accountId, cs.inboxAdded)
    return { newInboxIds: newIds, changed: true }
  }

  private async fetchMetadata(ids: string[]): Promise<number> {
    if (!ids.length) return 0
    let count = 0
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const res = await this.api.batch(chunk.map((id) => ({ method: 'GET', path: metaPath(id) })))
      const upserts = res
        .filter((r) => r && r.status === 200 && r.body && typeof r.body === 'object')
        .map((r) => toUpsert(this.accountId, r.body as GmailMessage))
      this.repo.upsertMessages(this.accountId, upserts)
      // 404s: message deleted meanwhile
      const gone = res.map((r, idx) => (r?.status === 404 ? chunk[idx] : null)).filter((x): x is string => !!x)
      this.repo.deleteByRemoteIds(this.accountId, gone)
      count += upserts.length
    }
    return count
  }

  private async refreshLabels(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const res = await this.api.batch(
        chunk.map((id) => ({ method: 'GET', path: `/gmail/v1/users/me/messages/${id}?format=minimal` }))
      )
      const updates = res
        .filter((r) => r?.status === 200)
        .map((r) => {
          const m = r.body as GmailMessage
          const labels = m.labelIds ?? []
          return {
            remoteId: m.id,
            isRead: !labels.includes('UNREAD'),
            isStarred: labels.includes('STARRED'),
            mailboxIds: labels.filter((l) => l !== 'UNREAD' && l !== 'CHAT').map((l) => mailboxId(this.accountId, l))
          }
        })
      this.repo.updateRemoteState(this.accountId, updates)
      const gone = res.map((r, idx) => (r?.status === 404 ? chunk[idx] : null)).filter((x): x is string => !!x)
      this.repo.deleteByRemoteIds(this.accountId, gone)
    }
  }

  async backfill(mbId: string | null): Promise<number> {
    const target = mbId ?? mailboxId(this.accountId, 'INBOX')
    const mb = this.repo.mailboxRow(target)
    const st = this.repo.getMailboxSync<MailboxSyncState>(target)
    if (st.exhausted) return 0
    const res = await this.api.request<{ messages?: { id: string }[]; nextPageToken?: string }>(
      'GET',
      '/gmail/v1/users/me/messages',
      {
        query: {
          labelIds: mb ? mb.remote_id : undefined,
          maxResults: 100,
          pageToken: st.nextPageToken ?? undefined,
          includeSpamTrash: mb?.role === 'trash' || mb?.role === 'junk' ? 'true' : undefined
        }
      }
    )
    const ids = (res.messages ?? []).map((m) => m.id)
    const have = this.repo.existingRemoteIds(this.accountId, ids)
    const n = await this.fetchMetadata(ids.filter((id) => !have.has(id)))
    this.repo.setMailboxSync(target, { nextPageToken: res.nextPageToken ?? null, exhausted: !res.nextPageToken })
    return n
  }

  async search(query: string): Promise<number[]> {
    const res = await this.api.request<{ messages?: { id: string }[] }>('GET', '/gmail/v1/users/me/messages', {
      query: { q: query, maxResults: 100 }
    })
    const ids = (res.messages ?? []).map((m) => m.id)
    const have = this.repo.existingRemoteIds(this.accountId, ids)
    await this.fetchMetadata(ids.filter((id) => !have.has(id)))
    return this.repo.idsByRemote(this.accountId, ids)
  }

  // ---------- bodies ----------
  async fetchBodies(refs: LocalMessageRef[]): Promise<Map<number, FetchedBody>> {
    const out = new Map<number, FetchedBody>()
    if (!refs.length) return out
    const res = await this.api.batch(
      refs.map((r) => ({ method: 'GET', path: `/gmail/v1/users/me/messages/${r.remoteId}?format=full` })),
      20
    )
    await Promise.all(
      res.map(async (r, i) => {
        if (r?.status !== 200) return
        const ref = refs[i]
        const msg = r.body as GmailMessage
        const ex = extractBody(msg.payload)
        let html = ex.html as string | null
        let text = ex.text as string | null
        for (const p of ex.pendingParts) {
          const data = await this.attachmentData(ref.remoteId, p.attachmentId)
          if (p.mimeType === 'text/html') html = (html ?? '') + data.toString('utf8')
          else text = (text ?? '') + data.toString('utf8')
        }
        // inline cid images → data URIs (small ones only)
        if (html) {
          for (const att of ex.attachments.filter((a) => a.contentId && a.size < 1_500_000)) {
            if (!html.includes(`cid:${att.contentId}`)) continue
            try {
              const data = await this.attachmentData(ref.remoteId, att.id)
              html = html.split(`cid:${att.contentId}`).join(`data:${att.mimeType};base64,${data.toString('base64')}`)
              att.inline = true
            } catch {
              /* ignore */
            }
          }
        }
        out.set(ref.id, {
          html,
          text,
          attachments: ex.attachments,
          plain: plainOf(html, text),
          snippet: ''
        })
      })
    )
    return out
  }

  private async attachmentData(messageRemoteId: string, attachmentId: string): Promise<Buffer> {
    const res = await this.api.request<{ data: string }>(
      'GET',
      `/gmail/v1/users/me/messages/${messageRemoteId}/attachments/${attachmentId}`
    )
    return fromBase64Url(res.data)
  }

  async fetchAttachment(ref: LocalMessageRef, att: AttachmentInfo): Promise<Buffer> {
    try {
      return await this.attachmentData(ref.remoteId, att.id)
    } catch (e) {
      // attachment ids rotate between fetches; refetch the message to get a fresh id
      if (!(e instanceof GmailHttpError)) throw e
      const msg = await this.api.request<GmailMessage>('GET', `/gmail/v1/users/me/messages/${ref.remoteId}`, {
        query: { format: 'full' }
      })
      const fresh = extractBody(msg.payload).attachments.find((a) => a.filename === att.filename && a.size === att.size)
      if (!fresh) throw e
      return await this.attachmentData(ref.remoteId, fresh.id)
    }
  }

  // ---------- mutations ----------
  async applyChanges(changes: StateChange[]): Promise<void> {
    const strip = (id: string): string => id.slice(this.accountId.length + 1)
    const trashOps: BatchRequest[] = []
    const groups = new Map<string, { add: string[]; remove: string[]; ids: string[] }>()
    for (const c of changes) {
      const before = new Set(c.before.labels.map(strip))
      const after = new Set(c.after.labels.map(strip))
      const add: string[] = []
      const remove: string[] = []
      for (const l of after) if (!before.has(l)) add.push(l)
      for (const l of before) if (!after.has(l)) remove.push(l)
      if (c.before.isRead !== c.after.isRead) (c.after.isRead ? remove : add).push('UNREAD')
      if (c.before.isStarred !== c.after.isStarred) {
        const target = c.after.isStarred ? add : remove
        if (!target.includes('STARRED')) target.push('STARRED')
      }
      // TRASH must go through trash/untrash endpoints
      const ti = add.indexOf('TRASH')
      if (ti >= 0) {
        add.splice(ti, 1)
        trashOps.push({ method: 'POST', path: `/gmail/v1/users/me/messages/${c.ref.remoteId}/trash` })
      }
      const ri = remove.indexOf('TRASH')
      if (ri >= 0) {
        remove.splice(ri, 1)
        trashOps.push({ method: 'POST', path: `/gmail/v1/users/me/messages/${c.ref.remoteId}/untrash` })
      }
      if (!add.length && !remove.length) continue
      const key = `${add.sort().join(',')}|${remove.sort().join(',')}`
      const g = groups.get(key) ?? { add, remove, ids: [] }
      g.ids.push(c.ref.remoteId)
      groups.set(key, g)
    }
    if (trashOps.length) {
      const res = await this.api.batch(trashOps)
      const bad = res.find((r) => !r || r.status >= 300)
      if (bad) throw new Error(`휴지통 작업 실패 (${bad.status})`)
    }
    for (const g of groups.values()) {
      for (let i = 0; i < g.ids.length; i += 1000) {
        await this.api.request('POST', '/gmail/v1/users/me/messages/batchModify', {
          body: { ids: g.ids.slice(i, i + 1000), addLabelIds: g.add, removeLabelIds: g.remove }
        })
      }
    }
  }

  async send(raw: Buffer, draft: Draft): Promise<void> {
    await this.api.request('POST', '/gmail/v1/users/me/messages/send', {
      body: { raw: toBase64Url(raw), ...(draft.threadId ? { threadId: draft.threadId } : {}) }
    })
  }
}
