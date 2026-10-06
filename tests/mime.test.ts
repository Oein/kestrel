import { describe, expect, it } from 'vitest'
import { simpleParser } from 'mailparser'
import { buildMime, envelopeOf, parseRecipients, replySubject, toBase64Url, fromBase64Url } from '../src/main/mime'
import type { Draft } from '../src/shared/types'

const base: Draft = {
  accountId: 'a',
  to: '홍길동 <hong@example.com>, test@example.org',
  cc: '',
  bcc: 'secret@example.com',
  subject: '안녕하세요 — 회의 일정',
  body: '본문입니다.\n두 번째 줄 https://example.com',
  attachments: []
}

describe('buildMime', () => {
  it('encodes Korean subject/body and parses back', async () => {
    const raw = await buildMime(base, { from: { name: '보낸이', email: 'me@example.com' }, keepBcc: false })
    const parsed = await simpleParser(raw)
    expect(parsed.subject).toBe(base.subject)
    expect(parsed.text?.trim()).toContain('두 번째 줄')
    expect(parsed.html).toContain('<a href="https://example.com">')
    expect(parsed.from?.value[0]).toMatchObject({ name: '보낸이', address: 'me@example.com' })
    const to = Array.isArray(parsed.to) ? parsed.to : [parsed.to!]
    expect(to.flatMap((t) => t.value.map((v) => v.address))).toEqual(['hong@example.com', 'test@example.org'])
    // SMTP: Bcc header must not leak
    expect(raw.toString()).not.toMatch(/^Bcc:/m)
  })

  it('keeps Bcc for the Gmail API and sets reply headers', async () => {
    const raw = await buildMime(
      { ...base, inReplyTo: '<parent@x>', references: '<root@x> <parent@x>', quotedHtml: '<p>원문</p>' },
      { from: { name: '', email: 'me@example.com' }, keepBcc: true }
    )
    const text = raw.toString()
    expect(text).toMatch(/^Bcc: secret@example.com/m)
    const parsed = await simpleParser(raw)
    expect(parsed.inReplyTo).toBe('<parent@x>')
    expect(parsed.references).toEqual(['<root@x>', '<parent@x>'])
    expect(parsed.html).toContain('<blockquote')
    expect(parsed.html).toContain('원문')
  })

  it('attaches files', async () => {
    const raw = await buildMime(
      { ...base, attachments: [{ path: __filename, filename: '테스트.ts', size: 1 }] },
      { from: { name: '', email: 'me@example.com' }, keepBcc: false }
    )
    const parsed = await simpleParser(raw)
    expect(parsed.attachments.map((a) => a.filename)).toEqual(['테스트.ts'])
  })
})

describe('helpers', () => {
  it('parses recipients incl. semicolons', () => {
    expect(parseRecipients('a@x.com; "B, Kim" <b@x.com>')).toEqual([
      { name: '', email: 'a@x.com' },
      { name: 'B, Kim', email: 'b@x.com' }
    ])
  })
  it('builds a deduplicated envelope', () => {
    expect(envelopeOf({ ...base, cc: 'test@example.org' }, { name: '', email: 'me@x' })).toEqual({
      from: 'me@x',
      to: ['hong@example.com', 'test@example.org', 'secret@example.com']
    })
  })
  it('prefixes reply subjects once', () => {
    expect(replySubject('hello', 'Re')).toBe('Re: hello')
    expect(replySubject('RE: hello', 'Re')).toBe('RE: hello')
    expect(replySubject('전달: x', 'Fwd')).toBe('전달: x')
  })
  it('base64url roundtrip', () => {
    const b = Buffer.from([0xfb, 0xff, 0xfe, 0x00, 0x41])
    expect(toBase64Url(b)).not.toMatch(/[+/=]/)
    expect(fromBase64Url(toBase64Url(b))).toEqual(b)
  })
})
