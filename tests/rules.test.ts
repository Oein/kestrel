import { describe, expect, it } from 'vitest'
import { Repo, type MessageState, type MessageUpsert } from '../src/main/db/repo'
import { planNotifications } from '../src/main/notify'
import { applyRuleResult, categoryOf, labelNames, placeholderId, sanitizeResult, type ApplyCtx } from '../src/main/rules/apply'
import { RuleEngine } from '../src/main/rules/engine'
import { runJsBatch, wrapJsRule } from '../src/main/rules/jsSandbox'
import { findPython, PythonRunner } from '../src/main/rules/python'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { StateChange } from '../src/main/providers/types'

const MSG = JSON.stringify({ subject: '(광고) 가을 세일', from: { name: 'GitHub', email: 'noreply@github.com' }, labels: ['INBOX'] })

describe('JS rule sandbox', () => {
  it('supports function, export default and bare-body forms', () => {
    const forms = [
      `function rule(msg) { return { addLabels: [msg.from.name.toLowerCase()] } }`,
      `export default (msg) => ({ addLabels: [msg.from.name.toLowerCase()] })`,
      `const rule = (msg) => ({ addLabels: [msg.from.name.toLowerCase()] })`,
      `if (msg.from.email.endsWith('@github.com')) return { addLabels: ['github'] }\nreturn null`
    ]
    for (const code of forms) {
      const out = runJsBatch(code, [MSG])
      expect(out.fatal).toBeNull()
      expect(out.outcomes[0]).toEqual({ result: { addLabels: ['github'] }, error: null, logs: [] })
    }
  })

  it('returns null for undefined and collects console.log', () => {
    const out = runJsBatch(`function rule(msg) { console.log('제목', msg.subject, { a: 1 }) }`, [MSG])
    expect(out.outcomes[0].result).toBeNull()
    expect(out.outcomes[0].logs).toEqual(['제목 (광고) 가을 세일 {"a":1}'])
  })

  it('times out per message and keeps going', () => {
    const code = `function rule(msg) { if (msg.n === 1) { while (true) {} } return { star: true } }`
    const t0 = Date.now()
    const out = runJsBatch(code, ['{"n":1}', '{"n":2}'], 100)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(out.outcomes[0].error).toMatch(/시간 초과/)
    expect(out.outcomes[1].result).toEqual({ star: true })
  })

  it('has no require / process / host escape', () => {
    const probe = (expr: string): unknown =>
      runJsBatch(`function rule() { try { return { v: String(${expr}) } } catch (e) { return { v: 'blocked' } } }`, [MSG])
        .outcomes[0].result
    expect(probe('typeof require')).toEqual({ v: 'undefined' })
    expect(probe('typeof process')).toEqual({ v: 'undefined' })
    expect(probe('typeof fetch')).toEqual({ v: 'undefined' })
    expect(probe(`this.constructor.constructor('return typeof process')()`)).toEqual({ v: 'blocked' })
    expect(probe(`(function(){}).constructor('return 1')()`)).toEqual({ v: 'blocked' })
    const err = runJsBatch(`function rule() { return require('fs') }`, [MSG]).outcomes[0]
    expect(err.error).toMatch(/require is not defined/)
  })

  it('reports syntax errors as fatal and runtime errors with a line number', () => {
    expect(runJsBatch(`function rule(msg) { return {`, [MSG]).fatal).toMatch(/SyntaxError/)
    const out = runJsBatch(`function rule(msg) {\n  return msg.nope.x\n}`, [MSG])
    expect(out.outcomes[0].error).toMatch(/TypeError.*\(2행\)/)
  })

  it('rejects async rules', () => {
    expect(runJsBatch(`async function rule() { return {} }`, [MSG]).outcomes[0].error).toMatch(/Promise/)
  })

  it('wraps bare bodies on the first line (line numbers match the editor)', () => {
    expect(wrapJsRule('return 1').split('\n')[0]).toContain('return 1')
  })
})

describe.skipIf(!findPython())('Python rule runner', () => {
  const runner = new PythonRunner(mkdtempSync(join(tmpdir(), 'mb-py-')))

  it('runs def rule(msg) over JSON lines', async () => {
    const code = `def rule(msg):\n    print('hi', msg['subject'])\n    if '광고' in msg['subject']:\n        return {'category': 'promotions'}\n    return None\n`
    const out = await runner.run(code, [MSG, JSON.stringify({ subject: '안녕' })], 500)
    expect(out.fatal).toBeNull()
    expect(out.outcomes[0]).toEqual({ result: { category: 'promotions' }, error: null, logs: ['hi (광고) 가을 세일'] })
    expect(out.outcomes[1].result).toBeNull()
  })

  it('times out, reports errors and missing rule()', async () => {
    const out = await runner.run(
      `def rule(msg):\n    if msg['n'] == 1:\n        while True: pass\n    return msg['missing']\n`,
      ['{"n":1}', '{"n":2}'],
      200
    )
    expect(out.outcomes[0].error).toMatch(/시간 초과/)
    expect(out.outcomes[1].error).toMatch(/KeyError.*\(4행\)/)
    expect((await runner.run('x = 1\n', [MSG], 200)).fatal).toMatch(/rule\(msg\)/)
    expect((await runner.run('def rule(msg) return\n', [MSG], 200)).fatal).toMatch(/SyntaxError/)
  })
})

// ---------- result → state mapping ----------
const gmail: ApplyCtx = {
  kind: 'gmail',
  accountId: 'g',
  mailboxes: [
    { id: 'g:INBOX', remoteId: 'INBOX', name: '받은편지함', path: '받은편지함', role: 'inbox', type: 'system' },
    { id: 'g:TRASH', remoteId: 'TRASH', name: '휴지통', path: '휴지통', role: 'trash', type: 'system' },
    { id: 'g:IMPORTANT', remoteId: 'IMPORTANT', name: '중요', path: '중요', role: 'important', type: 'system' },
    { id: 'g:CATEGORY_PROMOTIONS', remoteId: 'CATEGORY_PROMOTIONS', name: '프로모션', path: '프로모션', role: null, type: 'category' },
    { id: 'g:Label_1', remoteId: 'Label_1', name: 'github', path: 'company/github', role: null, type: 'user' }
  ]
}
const imap: ApplyCtx = {
  kind: 'imap',
  accountId: 'i',
  mailboxes: [
    { id: 'i:INBOX', remoteId: 'INBOX', name: '받은편지함', path: '받은편지함', role: 'inbox', type: 'system' },
    { id: 'i:Archive', remoteId: 'Archive', name: '보관함', path: '보관함', role: 'archive', type: 'system' },
    { id: 'i:Trash', remoteId: 'Trash', name: '휴지통', path: '휴지통', role: 'trash', type: 'system' },
    { id: 'i:Work', remoteId: 'Work', name: 'Work', path: 'Work', role: null, type: 'user' }
  ]
}
const st = (labels: string[], over: Partial<MessageState> = {}): MessageState => ({ id: 1, isRead: false, isStarred: false, labels, ...over })

describe('rule result → action mapping', () => {
  it('sanitizes results', () => {
    expect(sanitizeResult(null)).toBeNull()
    expect(sanitizeResult({})).toBeNull()
    expect(sanitizeResult({ addLabels: [' a ', 'a', 3], archive: true, junk: 1 })).toEqual({ addLabels: ['a'], archive: true })
    expect(() => sanitizeResult('x')).toThrow()
    expect(() => sanitizeResult({ category: 'forums' })).toThrow(/category/)
  })

  it('gmail: labels, categories, archive, read, star', () => {
    const out = applyRuleResult(
      st(['g:INBOX', 'g:CATEGORY_PROMOTIONS']),
      { addLabels: ['github', '새 라벨'], category: 'updates', archive: true, markRead: true, star: true },
      gmail
    )
    expect(out.isRead).toBe(true)
    expect(out.isStarred).toBe(true)
    expect(new Set(out.labels)).toEqual(new Set(['g:CATEGORY_UPDATES', 'g:Label_1', placeholderId('g', '새 라벨'), 'g:STARRED']))
    // primary = CATEGORY_PERSONAL on Gmail; removeLabels resolves system labels too
    const p = applyRuleResult(st(['g:INBOX', 'g:CATEGORY_PROMOTIONS', 'g:IMPORTANT']), { category: 'primary', removeLabels: ['important'] }, gmail)
    expect(p.labels).toEqual(['g:INBOX', 'g:CATEGORY_PERSONAL'])
    expect(applyRuleResult(st(['g:INBOX']), { trash: true }, gmail).labels).toContain('g:TRASH')
  })

  it('imap: first addLabel moves, categories are local labels kept across moves', () => {
    const cat = applyRuleResult(st(['i:INBOX']), { category: 'promotions' }, imap)
    expect(cat.labels).toEqual(['i:INBOX', 'i:CATEGORY_PROMOTIONS'])
    const moved = applyRuleResult(cat, { addLabels: ['work', 'other'], removeLabels: ['x'] }, imap)
    expect(moved.labels).toEqual(['i:Work', 'i:CATEGORY_PROMOTIONS'])
    expect(applyRuleResult(st(['i:INBOX']), { addLabels: ['새 폴더'] }, imap).labels).toEqual([placeholderId('i', '새 폴더')])
    expect(applyRuleResult(st(['i:INBOX']), { archive: true }, imap).labels).toEqual(['i:Archive'])
    expect(applyRuleResult(st(['i:INBOX']), { trash: true, addLabels: ['Work'] }, imap).labels).toEqual(['i:Trash'])
    expect(applyRuleResult(st(['i:INBOX', 'i:CATEGORY_SOCIAL']), { category: 'primary' }, imap).labels).toEqual(['i:INBOX'])
  })

  it('label names and category as rules see them', () => {
    expect(labelNames(['g:INBOX', 'g:Label_1', 'g:CATEGORY_PROMOTIONS', placeholderId('g', 'x')], gmail)).toEqual(['INBOX', 'company/github', 'x'])
    expect(categoryOf(['g:INBOX', 'g:CATEGORY_PROMOTIONS'], 'g')).toBe('promotions')
    expect(categoryOf(['g:INBOX'], 'g')).toBe('primary')
  })
})

// ---------- engine end-to-end (in-memory DB, JS runner without utilityProcess) ----------
function msg(over: Partial<MessageUpsert>): MessageUpsert {
  return {
    remoteId: 'r',
    threadId: 't',
    subject: '',
    from: { name: '', email: 'a@x.com' },
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

function setupEngine(): { repo: Repo; engine: RuleEngine; commits: Map<string, StateChange[]>[]; created: string[] } {
  const repo = new Repo(':memory:')
  for (const [id, provider] of [['g', 'gmail'], ['i', 'imap']] as const)
    repo.insertAccount({ id, provider, preset: provider === 'gmail' ? 'gmail' : 'naver', email: `${id}@x.com`, name: '', color: '#000', config_json: '{}', secret: null, oauth_client_id: null })
  repo.replaceMailboxes('g', gmail.mailboxes.map((m) => ({ remoteId: m.remoteId, name: m.name, path: m.path, role: m.role, type: m.type })))
  repo.replaceMailboxes('i', imap.mailboxes.map((m) => ({ remoteId: m.remoteId, name: m.name, path: m.path, role: m.role, type: m.type })))
  repo.upsertMessages('g', [
    msg({ remoteId: 'g1', subject: 'PR 리뷰 요청', from: { name: 'GitHub', email: 'noreply@github.com' }, date: 3, mailboxIds: ['g:INBOX'] }),
    msg({ remoteId: 'g2', subject: '(광고) 세일', date: 2, mailboxIds: ['g:INBOX'] })
  ])
  repo.upsertMessages('i', [msg({ remoteId: 'INBOX\u00011', subject: '[광고] 쿠폰', date: 1, mailboxIds: ['i:INBOX'] })])
  const commits: Map<string, StateChange[]>[] = []
  const created: string[] = []
  const js = { run: async (code: string, inputs: string[], t: number) => runJsBatch(code, inputs, t) }
  const engine = new RuleEngine(repo, {
    js,
    python: js,
    ensureLabel: async (accountId, name) => {
      created.push(`${accountId}/${name}`)
      return `${accountId}:Label_${name}`
    },
    commit: (c) => {
      commits.push(c)
      repo.applyStates([...c.values()].flat().map((x) => x.after))
    },
    emit: () => {}
  })
  return { repo, engine, commits, created }
}

describe('rule engine', () => {
  it('runs rules in order (later rules see earlier effects), creates labels and commits once', async () => {
    const { repo, engine, commits, created } = setupEngine()
    engine.save({ name: 'GitHub', enabled: true, language: 'js', accountId: null, code: `function rule(msg) { if (msg.from.email.endsWith('@github.com')) return { addLabels: ['github'] } }` })
    engine.save({ name: '광고', enabled: true, language: 'js', accountId: null, code: `if (/\\(광고\\)|\\[광고\\]/.test(msg.subject)) return { category: 'promotions', markRead: true }` })
    engine.save({ name: '후속', enabled: true, language: 'js', accountId: 'g', code: `if (msg.labels.includes('company/github')) return { star: true }` })
    engine.save({ name: '꺼짐', enabled: false, language: 'js', accountId: null, code: `return { trash: true }` })
    const sum = await engine.runNow()
    expect(sum).toEqual({ processed: 3, changed: 3, errors: [] })
    expect(created).toEqual([]) // 'github' resolves to the existing company/github label by short name
    expect(commits).toHaveLength(1)
    const [g1, g2] = repo.idsByRemote('g', ['g1', 'g2'])
    const [i1] = repo.idsByRemote('i', ['INBOX\u00011'])
    const states = new Map(repo.states([g1, g2, i1]).map((s) => [s.id, s]))
    expect(states.get(g1)).toMatchObject({ isStarred: true })
    expect(states.get(g1)!.labels).toContain('g:Label_1')
    expect(states.get(g2)).toMatchObject({ isRead: true })
    expect(states.get(g2)!.labels).toContain('g:CATEGORY_PROMOTIONS')
    expect(states.get(i1)!.labels.sort()).toEqual(['i:CATEGORY_PROMOTIONS', 'i:INBOX'])
    // IMAP local category mailboxes were created so the category tabs work
    expect(repo.mailboxInfos('i').some((m) => m.remote_id === 'CATEGORY_PROMOTIONS' && m.type === 'category')).toBe(true)
    expect(repo.listThreads({ kind: 'role', role: 'inbox', accountId: 'i', category: 'promotions' }, 0, 10).rows).toHaveLength(1)
    const rules = engine.list()
    expect(rules.map((r) => r.hitCount)).toEqual([1, 2, 1, 0])
    expect(rules[0].lastRunAt).not.toBeNull()
    expect(rules[3].lastRunAt).toBeNull()
  })

  it('records errors without breaking, creates missing labels, and test() does not apply', async () => {
    const { repo, engine, commits, created } = setupEngine()
    const bad = engine.save({ name: '오류', enabled: true, language: 'js', accountId: null, code: `return msg.nope.x` })
    engine.save({ name: '새 라벨', enabled: true, language: 'js', accountId: 'g', code: `return { addLabels: ['뉴스레터'] }` })
    const sum = await engine.runNow()
    expect(sum.errors[0]).toMatch(/^오류: TypeError/)
    expect(engine.list().find((r) => r.id === bad.id)!.lastError).toMatch(/TypeError/)
    expect(created).toEqual(['g/뉴스레터'])
    expect([...commits[0].values()].flat().every((c) => c.after.labels.includes('g:Label_뉴스레터'))).toBe(true)

    const [g2] = repo.idsByRemote('g', ['g2'])
    const t = await engine.test({ language: 'js', code: `console.log(msg.subject); return { archive: true }`, messageId: g2 })
    expect(t).toMatchObject({ result: { archive: true }, error: null, logs: ['(광고) 세일'] })
    expect(t.message?.labels).toContain('INBOX')
    expect(repo.states([g2])[0].labels).toContain('g:INBOX')
  })

  it('upserting an IMAP message keeps its local category labels', () => {
    const { repo } = setupEngine()
    const [i1] = repo.idsByRemote('i', ['INBOX\u00011'])
    repo.applyStates([{ id: i1, isRead: false, isStarred: false, labels: ['i:INBOX', 'i:CATEGORY_SOCIAL'] }])
    repo.upsertMessages('i', [msg({ remoteId: 'INBOX\u00011', mailboxIds: ['i:INBOX'] })], { keepLocalCategories: true })
    expect(repo.states([i1])[0].labels.sort()).toEqual(['i:CATEGORY_SOCIAL', 'i:INBOX'])
    repo.ensureLocalCategories('i')
    repo.replaceMailboxes('i', imap.mailboxes.map((m) => ({ remoteId: m.remoteId, name: m.name, path: m.path, role: m.role, type: m.type })), { keepCategories: true })
    expect(repo.mailboxInfos('i').filter((m) => m.type === 'category')).toHaveLength(3)
  })
})

describe('notifications', () => {
  const m = (id: number, name: string): { id: number; from: { name: string; email: string }; subject: string; snippet: string } => ({
    id,
    from: { name, email: `${id}@x.com` },
    subject: `제목 ${id}`,
    snippet: '내용'
  })
  it('shows each message up to 3, then one summary', () => {
    expect(planNotifications([])).toBeNull()
    const each = planNotifications([m(1, '가'), m(2, '')])
    expect(each).toEqual({
      kind: 'each',
      items: [
        { id: 1, title: '가', subtitle: '제목 1', body: '내용' },
        { id: 2, title: '2@x.com', subtitle: '제목 2', body: '내용' }
      ]
    })
    const sum = planNotifications([m(9, '가'), m(8, '나'), m(7, '가'), m(6, '다'), m(5, '라')])
    expect(sum).toEqual({ kind: 'summary', title: '새 메일 5통', body: '가, 나, 다 외 1명', newestId: 9 })
  })
})
