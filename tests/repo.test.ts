import { describe, expect, it } from 'vitest'
import { buildFtsQuery, Repo, type MessageUpsert } from '../src/main/db/repo'
import { computeAfter } from '../src/main/actions'
import { extractGoogleClients } from '../src/main/env'

function msg(over: Partial<MessageUpsert>): MessageUpsert {
  return {
    remoteId: 'r',
    threadId: 't',
    subject: '',
    from: { name: '보낸이', email: 'from@x.com' },
    to: [],
    cc: [],
    replyTo: [],
    snippet: '',
    date: 1,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    attachments: [],
    messageIdHeader: null,
    inReplyTo: null,
    references: null,
    size: 0,
    mailboxIds: [],
    ...over
  }
}

function setup(): Repo {
  const repo = new Repo(':memory:')
  repo.insertAccount({
    id: 'g',
    provider: 'gmail',
    preset: 'gmail',
    email: 'me@gmail.com',
    name: '',
    color: '#000',
    config_json: '{}',
    secret: null,
    oauth_client_id: null
  })
  repo.replaceMailboxes('g', [
    { remoteId: 'INBOX', name: '받은편지함', path: '받은편지함', role: 'inbox', type: 'system' },
    { remoteId: 'TRASH', name: '휴지통', path: '휴지통', role: 'trash', type: 'system' },
    { remoteId: 'CATEGORY_PROMOTIONS', name: '프로모션', path: '프로모션', role: null, type: 'category' },
    { remoteId: 'Label_1', name: '업무', path: '업무', role: null, type: 'user' }
  ])
  repo.upsertMessages('g', [
    msg({ remoteId: 'a1', threadId: 'A', subject: '프로젝트 회의', date: 100, mailboxIds: ['g:INBOX', 'g:Label_1'] }),
    msg({ remoteId: 'a2', threadId: 'A', subject: 'Re: 프로젝트 회의', date: 200, isRead: true, from: { name: '', email: 'me@gmail.com' } }),
    msg({ remoteId: 'b1', threadId: 'B', subject: '세일 안내', date: 150, mailboxIds: ['g:INBOX', 'g:CATEGORY_PROMOTIONS'] }),
    msg({ remoteId: 'c1', threadId: 'C', subject: '지난 메일', date: 50, isRead: true, mailboxIds: ['g:TRASH'] })
  ])
  return repo
}

describe('repo views', () => {
  it('groups threads and applies inbox categories', () => {
    const repo = setup()
    const primary = repo.listThreads({ kind: 'role', role: 'inbox', accountId: null, category: 'primary' }, 0, 50)
    expect(primary.rows.map((r) => r.subject)).toEqual(['프로젝트 회의'])
    const promos = repo.listThreads({ kind: 'role', role: 'inbox', accountId: null, category: 'promotions' }, 0, 50)
    expect(promos.rows.map((r) => r.subject)).toEqual(['세일 안내'])
    const all = repo.listThreads({ kind: 'role', role: 'all', accountId: null }, 0, 50)
    expect(all.rows.map((r) => [r.threadId, r.count])).toEqual([
      ['A', 2],
      ['B', 1]
    ])
    expect(all.rows[0].participants).toBe('보낸이, 나')
    expect(all.rows[0].unread).toBe(true)
    expect(repo.listThreads({ kind: 'role', role: 'trash', accountId: null }, 0, 50).rows.length).toBe(1)
    expect(repo.listThreads({ kind: 'label', mailboxId: 'g:Label_1', accountId: 'g' }, 0, 50).rows[0].labelIds).toEqual(['g:Label_1'])
  })

  it('searches with FTS (prefix, field filters)', () => {
    const repo = setup()
    const s = (q: string) => repo.listThreads({ kind: 'search', query: q, accountId: null }, 0, 50).rows.map((r) => r.threadId)
    expect(s('프로젝트')).toEqual(['A'])
    expect(s('세일')).toEqual(['B'])
    expect(s('지난')).toEqual([]) // trash excluded
    expect(s('from:me@gmail')).toEqual(['A'])
    expect(s('is:unread')).toEqual(['B', 'A']) // ordered by latest matching message
  })

  it('counts unread per mailbox and snapshots/restores state', () => {
    const repo = setup()
    expect(repo.listMailboxes().find((m) => m.id === 'g:INBOX')?.unread).toBe(2)
    const id = repo.idsByRemote('g', ['a1'])[0]
    const [before] = repo.states([id])
    const after = computeAfter({ type: 'archive' }, before, { kind: 'gmail', accountId: 'g', roleId: (r) => (r === 'inbox' ? 'g:INBOX' : r === 'trash' ? 'g:TRASH' : null) })
    expect(after.labels).toEqual(['g:Label_1'])
    repo.applyStates([after])
    expect(repo.unreadInboxTotal()).toBe(1)
    repo.applyStates([before])
    expect(repo.unreadInboxTotal()).toBe(2)
  })
})

describe('computeAfter (imap)', () => {
  const roleId = (r: string) => ({ inbox: 'i:INBOX', trash: 'i:Trash', archive: 'i:Archive' })[r] ?? null
  it('moves between folders', () => {
    const st = { id: 1, isRead: false, isStarred: false, labels: ['i:INBOX'] }
    expect(computeAfter({ type: 'archive' }, st, { kind: 'imap', accountId: 'i', roleId }).labels).toEqual(['i:Archive'])
    expect(computeAfter({ type: 'trash' }, st, { kind: 'imap', accountId: 'i', roleId }).labels).toEqual(['i:Trash'])
    expect(computeAfter({ type: 'star', value: true }, st, { kind: 'imap', accountId: 'i', roleId })).toMatchObject({ isStarred: true, labels: ['i:INBOX'] })
    expect(() => computeAfter({ type: 'archive' }, st, { kind: 'imap', accountId: 'i', roleId: (r) => (r === 'inbox' ? 'i:INBOX' : null) })).toThrow()
  })
})

describe('fts query builder', () => {
  it('builds prefix queries and flags', () => {
    expect(buildFtsQuery('hello wor')).toMatchObject({ match: '"hello"* AND "wor"*' })
    expect(buildFtsQuery('from:kim@x.com is:unread has:attachment')).toEqual({
      match: 'sender : "kim"* AND sender : "x"* AND sender : "com"*',
      unread: true,
      attachment: true,
      starred: false
    })
  })
})

describe('.env client extraction', () => {
  it('supports suffix convention', () => {
    const list = extractGoogleClients({
      GOOGLE_CLIENT_ID_SCHOOL: 'id2',
      GOOGLE_CLIENT_SECRET_SCHOOL: 's2',
      GOOGLE_CLIENT_DOMAINS_SCHOOL: 'Example.ac.kr, foo.kr',
      GOOGLE_CLIENT_ID: 'id1',
      GOOGLE_CLIENT_SECRET: 's1',
      OTHER: 'x'
    })
    expect(list).toEqual([
      { suffix: null, clientId: 'id1', clientSecret: 's1', domains: [] },
      { suffix: 'SCHOOL', clientId: 'id2', clientSecret: 's2', domains: ['example.ac.kr', 'foo.kr'] }
    ])
  })
})
