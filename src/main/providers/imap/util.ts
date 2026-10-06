import type { MessageStructureObject } from 'imapflow'
import type { AttachmentInfo, MailboxRole } from '../../../shared/types'
import { htmlToText } from '../../mime'

const SPECIAL_USE: Record<string, MailboxRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Archive': 'archive',
  '\\Junk': 'junk',
  '\\All': 'all'
}

const NAME_ROLES: [RegExp, MailboxRole][] = [
  [/^(sent( messages| items| mail)?|보낸\s?(메일|편지)함)$/i, 'sent'],
  [/^(drafts?|임시\s?보관함)$/i, 'drafts'],
  [/^(trash|deleted( messages| items)?|휴지통)$/i, 'trash'],
  [/^(archive|보관함|저장함)$/i, 'archive'],
  [/^(junk|spam|bulk mail|스팸\s?(메일|편지)함)$/i, 'junk']
]

export function roleOf(path: string, name: string, specialUse?: string): MailboxRole | null {
  if (path.toUpperCase() === 'INBOX') return 'inbox'
  if (specialUse && SPECIAL_USE[specialUse]) return SPECIAL_USE[specialUse]
  for (const [re, role] of NAME_ROLES) if (re.test(name)) return role
  return null
}

export const ROLE_NAMES: Record<string, string> = {
  inbox: '받은편지함',
  sent: '보낸편지함',
  drafts: '임시보관함',
  trash: '휴지통',
  archive: '보관함',
  junk: '스팸',
  all: '전체보관함'
}

export function walkStructure(node: MessageStructureObject | undefined, cb: (n: MessageStructureObject) => void): void {
  if (!node) return
  cb(node)
  for (const c of node.childNodes ?? []) walkStructure(c, cb)
}

export function attachmentsFromStructure(root: MessageStructureObject | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = []
  walkStructure(root, (n) => {
    if (n.childNodes?.length) return
    const filename = n.dispositionParameters?.filename ?? n.parameters?.name
    const isAttachment = n.disposition === 'attachment' || (!!filename && !n.type.startsWith('text/'))
    if (!isAttachment || !filename) return
    const cid = n.id?.replace(/[<>]/g, '') ?? null
    out.push({
      id: n.part ?? '1',
      filename,
      mimeType: n.type,
      size: n.size ?? 0,
      contentId: cid,
      inline: n.disposition === 'inline' && !!cid && n.type.startsWith('image/')
    })
  })
  return out
}

/** First text/plain (or text/html) leaf, for snippet extraction. */
export function snippetPart(root: MessageStructureObject | undefined): MessageStructureObject | null {
  let plain: MessageStructureObject | null = null
  let html: MessageStructureObject | null = null
  walkStructure(root, (n) => {
    if (n.childNodes?.length || n.disposition === 'attachment') return
    if (n.type === 'text/plain' && !plain) plain = n
    if (n.type === 'text/html' && !html) html = n
  })
  return plain ?? html
}

export function decodeTransfer(buf: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? '').toLowerCase()
  if (enc === 'base64') {
    const s = buf.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '')
    return Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64')
  }
  if (enc === 'quoted-printable') {
    const s = buf.toString('binary').replace(/=\r?\n/g, '')
    const bytes: number[] = []
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
        i += 2
      } else bytes.push(s.charCodeAt(i) & 0xff)
    }
    return Buffer.from(bytes)
  }
  return buf
}

export function decodeCharset(buf: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

export function makeSnippet(content: string, isHtml: boolean): string {
  const text = isHtml ? htmlToText(content) : content
  return text
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/�+$/, '')
    .trim()
    .slice(0, 200)
}

/** Root message id of a conversation, from References / In-Reply-To / Message-ID. */
export function threadKey(references: string | null, inReplyTo: string | null, messageId: string | null, fallback: string): string {
  const first = references?.match(/<[^>]+>/)?.[0]
  return first ?? inReplyTo?.match(/<[^>]+>/)?.[0] ?? messageId ?? fallback
}

export function headerValue(headers: Buffer | undefined, name: string): string | null {
  if (!headers) return null
  const text = headers.toString('utf8').replace(/\r?\n[ \t]+/g, ' ')
  const re = new RegExp(`^${name}:\\s*(.*)$`, 'im')
  return re.exec(text)?.[1]?.trim() ?? null
}
