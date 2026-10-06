import MailComposer from 'nodemailer/lib/mail-composer'
import addressparser from 'nodemailer/lib/addressparser'
import type { Address, Draft } from '../shared/types'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  return linked.replace(/\r?\n/g, '<br>')
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

/** Parse a user-entered recipient field ("a@b.com, 홍길동 <c@d.com>"). */
export function parseRecipients(field: string): Address[] {
  if (!field.trim()) return []
  const out: Address[] = []
  for (const a of addressparser(field.replace(/;/g, ','), { flatten: true })) {
    if (a.address) out.push({ name: a.name ?? '', email: a.address })
  }
  return out
}

export function formatAddress(a: Address): string {
  return a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email
}

export interface BuildOptions {
  from: Address
  /** keep the Bcc header (Gmail API uses it to deliver and strips it); SMTP must not */
  keepBcc: boolean
  date?: Date
  messageId?: string
}

/** Build an RFC 2822 message from a draft. */
export async function buildMime(draft: Draft, opts: BuildOptions): Promise<Buffer> {
  const text = draft.body
  const bodyHtml = `<div dir="auto">${textToHtml(draft.body)}</div>`
  const html = draft.quotedHtml
    ? `${bodyHtml}<br><blockquote class="mb_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${draft.quotedHtml}</blockquote>`
    : bodyHtml
  const references = [draft.references, draft.inReplyTo]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter((v, i, arr) => v && arr.indexOf(v) === i)
  const composer = new MailComposer({
    from: formatAddress(opts.from),
    to: parseRecipients(draft.to).map(formatAddress),
    cc: parseRecipients(draft.cc).map(formatAddress),
    bcc: parseRecipients(draft.bcc).map(formatAddress),
    subject: draft.subject,
    text,
    html,
    inReplyTo: draft.inReplyTo ?? undefined,
    references: references.length ? references : undefined,
    date: opts.date ?? new Date(),
    messageId: opts.messageId,
    attachments: draft.attachments.map((a) => ({ filename: a.filename, path: a.path }))
  })
  const node = composer.compile()
  node.keepBcc = opts.keepBcc
  return await node.build()
}

export function envelopeOf(draft: Draft, from: Address): { from: string; to: string[] } {
  const to = [...parseRecipients(draft.to), ...parseRecipients(draft.cc), ...parseRecipients(draft.bcc)].map((a) => a.email)
  return { from: from.email, to: [...new Set(to)] }
}

/** Gmail "raw" field: base64url */
export function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function replySubject(subject: string, prefix: 'Re' | 'Fwd'): string {
  const re = prefix === 'Re' ? /^(re|회신|답장)\s*:/i : /^(fwd?|전달)\s*:/i
  return re.test(subject.trim()) ? subject : `${prefix}: ${subject}`
}
