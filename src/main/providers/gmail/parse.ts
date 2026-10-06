import addressparser from 'nodemailer/lib/addressparser'
import type { Address, AttachmentInfo } from '../../../shared/types'
import type { MessageUpsert } from '../../db/repo'
import { mailboxId } from '../../db/repo'
import { fromBase64Url, htmlToText } from '../../mime'

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  internalDate?: string
  sizeEstimate?: number
  payload?: GmailPart
}

export const METADATA_HEADERS = ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References']

export function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null
}

export function parseAddresses(value: string | null): Address[] {
  if (!value) return []
  try {
    return addressparser(value, { flatten: true })
      .filter((a) => a.address)
      .map((a) => ({ name: a.name ?? '', email: a.address! }))
  } catch {
    return []
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Gmail labels that are flags or that we don't store as membership */
const NON_MEMBERSHIP = new Set(['UNREAD', 'CHAT'])

export function labelIdsToMailboxes(accountId: string, labelIds: string[] | undefined): string[] {
  return (labelIds ?? []).filter((l) => !NON_MEMBERSHIP.has(l)).map((l) => mailboxId(accountId, l))
}

function walkParts(part: GmailPart | undefined, cb: (p: GmailPart) => void): void {
  if (!part) return
  cb(part)
  for (const p of part.parts ?? []) walkParts(p, cb)
}

export function attachmentsOf(payload: GmailPart | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = []
  walkParts(payload, (p) => {
    if (!p.filename || !p.body?.attachmentId) return
    const disposition = header(p.headers, 'Content-Disposition') ?? ''
    const cid = header(p.headers, 'Content-ID')?.replace(/[<>]/g, '') ?? null
    out.push({
      id: p.body.attachmentId,
      filename: p.filename,
      mimeType: p.mimeType ?? 'application/octet-stream',
      size: p.body.size ?? 0,
      contentId: cid,
      inline: !!cid && /^inline/i.test(disposition) && (p.mimeType ?? '').startsWith('image/')
    })
  })
  return out
}

export function toUpsert(accountId: string, m: GmailMessage): MessageUpsert {
  const h = m.payload?.headers
  const from = parseAddresses(header(h, 'From'))[0] ?? { name: '', email: '' }
  const labels = m.labelIds ?? []
  const atts = attachmentsOf(m.payload).filter((a) => !a.inline)
  const mime = m.payload?.mimeType ?? ''
  return {
    remoteId: m.id,
    threadId: m.threadId,
    subject: header(h, 'Subject') ?? '',
    from,
    to: parseAddresses(header(h, 'To')),
    cc: parseAddresses(header(h, 'Cc')),
    replyTo: parseAddresses(header(h, 'Reply-To')),
    snippet: decodeEntities(m.snippet ?? ''),
    date: Number(m.internalDate ?? Date.now()),
    isRead: !labels.includes('UNREAD'),
    isStarred: labels.includes('STARRED'),
    hasAttachments: atts.length > 0 || mime === 'multipart/mixed',
    attachments: atts,
    messageIdHeader: header(h, 'Message-ID'),
    inReplyTo: header(h, 'In-Reply-To'),
    references: header(h, 'References'),
    size: m.sizeEstimate ?? 0,
    mailboxIds: labelIdsToMailboxes(accountId, labels)
  }
}

export interface ExtractedBody {
  html: string | null
  text: string | null
  attachments: AttachmentInfo[]
  /** html/text parts too large to be inlined in format=full (need attachments.get) */
  pendingParts: { attachmentId: string; mimeType: string }[]
}

const decodePart = (p: GmailPart): string => (p.body?.data ? fromBase64Url(p.body.data).toString('utf8') : '')

/** Pick the best html/text alternatives from a format=full payload. */
export function extractBody(payload: GmailPart | undefined): ExtractedBody {
  let html: string | null = null
  let text: string | null = null
  const pending: ExtractedBody['pendingParts'] = []
  walkParts(payload, (p) => {
    if (p.filename) return
    const mt = (p.mimeType ?? '').toLowerCase()
    if (mt !== 'text/html' && mt !== 'text/plain') return
    if (!p.body?.data && p.body?.attachmentId) {
      pending.push({ attachmentId: p.body.attachmentId, mimeType: mt })
      return
    }
    const content = decodePart(p)
    if (mt === 'text/html') html = html === null ? content : html + content
    else text = text === null ? content : text + '\n' + content
  })
  return { html, text, attachments: attachmentsOf(payload), pendingParts: pending }
}

export function plainOf(html: string | null, text: string | null): string {
  return text ?? (html ? htmlToText(html) : '')
}
