import { describe, expect, it } from 'vitest'
import { reduceHistory } from '../src/main/providers/gmail/history'
import { extractBody, toUpsert } from '../src/main/providers/gmail/parse'

const m = (id: string, labelIds?: string[]) => ({ message: { id, threadId: 't', labelIds } })

describe('reduceHistory', () => {
  it('collects added / deleted / relabeled with correct precedence', () => {
    const cs = reduceHistory([
      { id: '10', messagesAdded: [m('a', ['INBOX', 'UNREAD']), m('b', ['SENT'])] },
      { id: '11', labelsAdded: [{ ...m('c'), labelIds: ['STARRED'] }] },
      { id: '12', labelsRemoved: [{ ...m('a'), labelIds: ['UNREAD'] }] },
      { id: '13', messagesDeleted: [m('b')] },
      { id: '14', labelsRemoved: [{ ...m('d'), labelIds: ['INBOX'] }] }
    ])
    expect(cs.added.sort()).toEqual(['a'])
    expect(cs.deleted).toEqual(['b'])
    expect(cs.relabeled.sort()).toEqual(['c', 'd'])
    expect(cs.inboxAdded).toEqual(['a'])
  })

  it('processes records in historyId order', () => {
    const cs = reduceHistory([
      { id: '21', messagesAdded: [m('x', ['INBOX'])] },
      { id: '20', messagesDeleted: [m('x')] }
    ])
    // delete (20) happened before add (21) → message exists
    expect(cs.added).toEqual(['x'])
    expect(cs.deleted).toEqual([])
  })

  it('archiving a new message removes it from notification candidates', () => {
    const cs = reduceHistory([
      { id: '1', messagesAdded: [m('n', ['INBOX', 'UNREAD'])] },
      { id: '2', labelsRemoved: [{ ...m('n'), labelIds: ['INBOX'] }] }
    ])
    expect(cs.inboxAdded).toEqual([])
    expect(cs.added).toEqual(['n'])
    expect(cs.relabeled).toEqual([])
  })
})

describe('gmail parse', () => {
  it('maps metadata to an upsert', () => {
    const u = toUpsert('acc', {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD', 'STARRED', 'Label_5', 'CATEGORY_PERSONAL'],
      snippet: 'Tom &amp; Jerry&#39;s',
      internalDate: '1700000000000',
      sizeEstimate: 1234,
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: '"홍길동" <hong@example.com>' },
          { name: 'To', value: 'a@x.com, b@x.com' },
          { name: 'Subject', value: '제목' },
          { name: 'Message-ID', value: '<id@x>' }
        ]
      }
    })
    expect(u).toMatchObject({
      remoteId: 'm1',
      threadId: 't1',
      subject: '제목',
      from: { name: '홍길동', email: 'hong@example.com' },
      snippet: "Tom & Jerry's",
      isRead: false,
      isStarred: true,
      hasAttachments: true,
      date: 1700000000000,
      messageIdHeader: '<id@x>'
    })
    expect(u.to.map((a) => a.email)).toEqual(['a@x.com', 'b@x.com'])
    expect(u.mailboxIds).toEqual(['acc:INBOX', 'acc:STARRED', 'acc:Label_5', 'acc:CATEGORY_PERSONAL'])
  })

  it('extracts html/text/attachments from a full payload', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url')
    const ex = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('안녕') } },
            { mimeType: 'text/html', body: { data: b64('<b>안녕</b>') } }
          ]
        },
        {
          mimeType: 'application/pdf',
          filename: 'a.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="a.pdf"' }],
          body: { attachmentId: 'ATT1', size: 99 }
        },
        {
          mimeType: 'text/html',
          body: { attachmentId: 'BIG', size: 999999 }
        }
      ]
    })
    expect(ex.text).toBe('안녕')
    expect(ex.html).toBe('<b>안녕</b>')
    expect(ex.attachments).toEqual([
      { id: 'ATT1', filename: 'a.pdf', mimeType: 'application/pdf', size: 99, contentId: null, inline: false }
    ])
    expect(ex.pendingParts).toEqual([{ attachmentId: 'BIG', mimeType: 'text/html' }])
  })
})
