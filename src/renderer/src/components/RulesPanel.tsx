// "자동 분류" settings tab body: JavaScript / Python rules that label, categorize and archive incoming mail.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rule, RuleLanguage, RuleSampleMessage, RuleTestResult } from '../../../shared/types'
import { api, toast, useStore } from '../store'
import { Icon } from './Icon'
import { confirmDialog } from './Confirm'
import { btn, Checkbox, cx, Field, IconButton, inputCls } from './ui'

const CONTRACT = `// msg 예:
//   { from: { name, email }, to: [...], cc: [...], subject, snippet,
//     text (본문이 저장돼 있으면 문자열, 아니면 null), date (ms),
//     labels: ['INBOX', 'company/github', ...], category: 'primary' | 'promotions' | 'social' | 'updates',
//     unread, starred, hasAttachments, attachments: [{ filename, mimeType, size }],
//     account: { id, email, provider: 'gmail' | 'imap' } }
// 반환값 (아무것도 하지 않으려면 null):
//   { addLabels: ['라벨'], removeLabels: ['라벨'], category: 'promotions',
//     archive: true, markRead: true, star: true, trash: true }
// Gmail: 없는 라벨은 새로 만듭니다. IMAP: addLabels의 첫 번째 폴더로 이동하고(removeLabels는 무시),
// 분류(category)는 이 앱에만 저장됩니다. 규칙은 위에서부터 차례로 실행되며, 뒤 규칙은 앞 규칙의 결과를 봅니다.`

export const RULE_TEMPLATES: Record<RuleLanguage, string> = {
  js: String.raw`// 새 메일마다 rule(msg)가 호출됩니다. 메일 한 통당 200ms 안에 끝나야 합니다.
// (함수 본문만 적어도 됩니다: msg를 쓰고 return 하세요.)
${CONTRACT}
// console.log(...) 출력은 테스트 결과에 표시됩니다.

function rule(msg) {
  const from = msg.from.email.toLowerCase()

  // GitHub 알림 → 'github' 라벨
  if (from.endsWith('@github.com')) {
    return { addLabels: ['github'] }
  }

  // 제목이 광고 / (광고) / [광고]로 시작 → 프로모션 탭으로, 읽음 처리
  if (/^\s*[(\[]?광고[)\]]?/.test(msg.subject)) {
    return { category: 'promotions', markRead: true }
  }

  // 학교 도메인에서 온 메일 → '학교' 라벨 (도메인을 바꾸세요)
  if (from.endsWith('@school.ac.kr')) {
    return { addLabels: ['학교'] }
  }

  return null
}
`,
  python: String.raw`# 새 메일마다 rule(msg)가 호출됩니다 (python3 필요). 메일 한 통당 0.5초 안에 끝나야 합니다.
${CONTRACT.replace(/^\/\/ ?/gm, '# ').replace(/null/g, 'None').replace(/true/g, 'True')}
# print(...) 출력은 테스트 결과에 표시됩니다.
import re


def rule(msg):
    sender = msg['from']['email'].lower()

    # GitHub 알림 → 'github' 라벨
    if sender.endswith('@github.com'):
        return {'addLabels': ['github']}

    # 제목이 광고 / (광고) / [광고]로 시작 → 프로모션 탭으로, 읽음 처리
    if re.match(r'^\s*[(\[]?광고[)\]]?', msg['subject']):
        return {'category': 'promotions', 'markRead': True}

    # 학교 도메인에서 온 메일 → '학교' 라벨 (도메인을 바꾸세요)
    if sender.endswith('@school.ac.kr'):
        return {'addLabels': ['학교']}

    return None
`
}

const LANG_LABEL: Record<RuleLanguage, string> = { js: 'JavaScript', python: 'Python' }

interface Draft {
  name: string
  code: string
  accountId: string | null
}

function timeAgo(ms: number | null): string {
  if (!ms) return '실행 안 됨'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return '방금 실행'
  if (s < 3600) return `${Math.floor(s / 60)}분 전 실행`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전 실행`
  return `${new Date(ms).toLocaleDateString('ko-KR')} 실행`
}

/** Monospace textarea with Tab / Shift+Tab indentation (native undo is kept via insertText). */
function CodeEditor(props: { value: string; onChange: (v: string) => void; indent: string; onSave: () => void }): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation()
    const ta = e.currentTarget
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      props.onSave()
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()
    const { selectionStart: a, selectionEnd: b, value } = ta
    const lineStart = value.lastIndexOf('\n', a - 1) + 1
    if (!e.shiftKey && a === b) {
      document.execCommand('insertText', false, props.indent)
      return
    }
    // indent / outdent every selected line
    const block = value.slice(lineStart, b)
    const lines = block.split('\n')
    const next = e.shiftKey
      ? lines.map((l) => l.replace(new RegExp(`^( {1,${props.indent.length}}|\\t)`), ''))
      : lines.map((l) => props.indent + l)
    ta.setSelectionRange(lineStart, b)
    document.execCommand('insertText', false, next.join('\n'))
    ta.setSelectionRange(lineStart, lineStart + next.join('\n').length)
  }
  return (
    <textarea
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="block h-[300px] w-full resize-y rounded-lg border border-line-strong bg-surface p-3 font-mono text-[12px] leading-[1.6] text-ink outline-none [tab-size:4] focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
    />
  )
}

export function RulesPanel(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [samples, setSamples] = useState<RuleSampleMessage[]>([])
  const [sampleId, setSampleId] = useState<number | null>(null)
  const [test, setTest] = useState<RuleTestResult | null>(null)
  const [showInput, setShowInput] = useState(false)
  const draftFor = useRef<string | null>(null)

  const sel = rules?.find((r) => r.id === selId) ?? null
  const dirty = !!sel && !!draft && (draft.name !== sel.name || draft.code !== sel.code || draft.accountId !== sel.accountId)

  const reload = useCallback(async () => {
    const list = await api.rules.list()
    setRules(list)
    setSelId((cur) => (cur && list.some((r) => r.id === cur) ? cur : (list[0]?.id ?? null)))
  }, [])

  useEffect(() => {
    void reload()
    void api.rules.samples(30).then(setSamples)
    return api.on('rules:changed', () => void reload())
  }, [reload])

  // load the editor when the selection changes (not when stats refresh)
  useEffect(() => {
    if (!sel || draftFor.current === sel.id) return
    draftFor.current = sel.id
    setDraft({ name: sel.name, code: sel.code, accountId: sel.accountId })
    setTest(null)
  }, [sel])

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label)
    try {
      return await fn()
    } catch (e) {
      toast('error', (e as Error).message)
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const select = async (id: string): Promise<void> => {
    if (id === selId) return
    if (dirty && !(await confirmDialog({ title: '저장하지 않은 변경 사항을 버릴까요?', confirmLabel: '버리기', danger: true }))) return
    draftFor.current = null
    setSelId(id)
  }

  const add = async (language: RuleLanguage): Promise<void> => {
    if (dirty && !(await confirmDialog({ title: '저장하지 않은 변경 사항을 버릴까요?', confirmLabel: '버리기', danger: true }))) return
    void run('add', async () => {
      const n = (rules?.length ?? 0) + 1
      // new rules start disabled: test first, then turn on
      const r = await api.rules.save({ name: `규칙 ${n}`, enabled: false, language, code: RULE_TEMPLATES[language], accountId: null })
      draftFor.current = null
      await reload()
      setSelId(r.id)
    })
  }

  const save = (): void => {
    if (!sel || !draft) return
    void run('save', async () => {
      await api.rules.save({ id: sel.id, name: draft.name, enabled: sel.enabled, language: sel.language, code: draft.code, accountId: draft.accountId })
      toast('success', '규칙을 저장했습니다.')
    })
  }

  const toggle = (r: Rule): void => {
    void run('toggle', () =>
      api.rules.save({ id: r.id, name: r.name, enabled: !r.enabled, language: r.language, code: r.code, accountId: r.accountId })
    )
  }

  const move = (r: Rule, delta: number): void => {
    if (!rules) return
    const ids = rules.map((x) => x.id)
    const i = ids.indexOf(r.id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setRules(ids.map((id) => rules.find((x) => x.id === id)!))
    void run('reorder', () => api.rules.reorder(ids))
  }

  const remove = async (): Promise<void> => {
    if (!sel || !(await confirmDialog({ title: `"${sel.name}" 규칙을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return
    void run('remove', async () => {
      await api.rules.remove(sel.id)
      draftFor.current = null
      setSelId(null)
    })
  }

  const runTest = (): void => {
    if (!sel || !draft) return
    void run('test', async () => {
      setTest(await api.rules.test({ language: sel.language, code: draft.code, messageId: sampleId ?? undefined }))
    })
  }

  const runNow = (ruleId?: string): void => {
    if (ruleId && dirty) {
      toast('info', '먼저 규칙을 저장하세요.')
      return
    }
    void run(ruleId ? 'runOne' : 'runAll', async () => {
      const s = await api.rules.runNow(ruleId)
      toast(
        s.errors.length ? 'error' : 'success',
        `메일 ${s.processed}통 검사, ${s.changed}통 변경${s.errors.length ? ` · 오류: ${s.errors[0]}` : ''}`
      )
    })
  }

  if (!rules) return <div className="py-10 text-center text-[12.5px] text-ink-3">자동 분류 규칙을 불러오는 중…</div>

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        새 메일이 받은편지함에 도착하면 켜 둔 규칙이 위에서부터 차례로 실행되어 라벨·분류·보관·읽음 처리를 합니다. 규칙은
        JavaScript(격리된 샌드박스) 또는 Python(python3)으로 작성합니다.
      </p>

      {/* rule list */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="flex-1 text-[11.5px] font-semibold tracking-wide text-ink-3">규칙</h3>
          <button className={btn.ghost} onClick={() => add('js')} disabled={!!busy}>
            <Icon name="plus" size={14} />
            JavaScript
          </button>
          <button className={btn.ghost} onClick={() => add('python')} disabled={!!busy}>
            <Icon name="plus" size={14} />
            Python
          </button>
          <button className={btn.secondary} onClick={() => runNow()} disabled={!!busy || !rules.some((r) => r.enabled)} title="켜 둔 모든 규칙을 최근 받은편지함 메일 500통에 적용">
            <Icon name={busy === 'runAll' ? 'spinner' : 'refresh'} size={14} />
            지금 받은편지함에 적용
          </button>
        </div>
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[12.5px] text-ink-3">
            아직 규칙이 없습니다. 위에서 JavaScript 또는 Python 규칙을 추가하세요.
          </div>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {rules.map((r, i) => (
              <div
                key={r.id}
                onClick={() => select(r.id)}
                className={cx('group flex h-[46px] items-center gap-3 px-3', r.id === selId ? 'bg-active' : 'hover:bg-hover')}
              >
                <Checkbox checked={r.enabled} onChange={() => toggle(r)} title={r.enabled ? '끄기' : '켜기'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx('truncate text-[13px] font-medium', r.enabled ? 'text-ink' : 'text-ink-3')}>{r.name}</span>
                    <span className="shrink-0 rounded border border-line px-1 text-[10.5px] font-medium text-ink-3">{LANG_LABEL[r.language]}</span>
                    {r.lastError && <Icon name="warning" size={13} className="text-danger" />}
                  </div>
                  <div className="truncate text-[11.5px] text-ink-3">
                    {r.accountId ? (accounts.find((a) => a.id === r.accountId)?.email ?? '삭제된 계정') : '모든 계정'} · {r.hitCount}회 적용 ·{' '}
                    {timeAgo(r.lastRunAt)}
                  </div>
                </div>
                <div className="flex opacity-0 group-hover:opacity-100">
                  <IconButton icon="chevronDown" iconClassName="rotate-180" size="sm" title="위로" onClick={() => move(r, -1)} className={i === 0 ? 'invisible' : ''} />
                  <IconButton icon="chevronDown" size="sm" title="아래로" onClick={() => move(r, 1)} className={i === rules.length - 1 ? 'invisible' : ''} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* editor */}
      {sel && draft && (
        <section className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="이름">
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
            </div>
            <div className="w-[220px]">
              <Field label="계정">
                <select
                  className={inputCls}
                  value={draft.accountId ?? ''}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value || null })}
                >
                  <option value="">모든 계정</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {sel.lastError && (
            <div className="flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] text-danger">
              <Icon name="warning" size={14} className="mt-px" />
              <span className="selectable min-w-0 flex-1 break-words font-mono">{sel.lastError}</span>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center text-[12px] font-medium text-ink-2">
              <span className="flex-1">
                {LANG_LABEL[sel.language]} 코드 {sel.language === 'js' ? '— function rule(msg) { … }' : '— def rule(msg): …'}
              </span>
              {dirty && <span className="text-warn">저장 안 됨</span>}
            </div>
            <CodeEditor
              value={draft.code}
              onChange={(code) => setDraft({ ...draft, code })}
              indent={sel.language === 'python' ? '    ' : '  '}
              onSave={save}
            />
          </div>

          <div className="flex items-center gap-2">
            <button className={btn.primary} onClick={save} disabled={!!busy || !dirty}>
              저장
            </button>
            <button className={btn.secondary} onClick={() => runNow(sel.id)} disabled={!!busy} title="이 규칙만 최근 받은편지함 메일 500통에 적용 (꺼져 있어도)">
              <Icon name={busy === 'runOne' ? 'spinner' : 'refresh'} size={14} />이 규칙만 적용
            </button>
            <span className="flex-1" />
            <button className={btn.danger} onClick={remove} disabled={!!busy}>
              삭제
            </button>
          </div>

          {/* test */}
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <select
                className={cx(inputCls, 'h-8 flex-1 text-[12.5px]')}
                value={sampleId ?? ''}
                onChange={(e) => setSampleId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">가장 최근 받은 메일</option>
                {samples.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.from.name || m.from.email).slice(0, 20)} — {m.subject || '(제목 없음)'}
                  </option>
                ))}
              </select>
              <button className={btn.secondary} onClick={runTest} disabled={!!busy} title="저장하지 않은 코드로 실행하며, 메일은 바뀌지 않습니다">
                <Icon name={busy === 'test' ? 'spinner' : 'check'} size={14} />
                테스트
              </button>
            </div>
            {test && (
              <div className="mt-3 space-y-2 text-[12px]">
                <div className="flex items-center gap-2">
                  {test.error ? (
                    <span className="font-medium text-danger">오류</span>
                  ) : test.result ? (
                    <span className="font-medium text-ok">결과</span>
                  ) : (
                    <span className="font-medium text-ink-2">변경 없음 (null)</span>
                  )}
                  <span className="text-ink-3">{test.ms}ms</span>
                  {test.message && (
                    <span className="min-w-0 flex-1 truncate text-right text-ink-3">{test.message.subject || '(제목 없음)'}</span>
                  )}
                </div>
                {test.error && <pre className="selectable whitespace-pre-wrap break-words rounded-lg bg-hover p-2.5 font-mono text-danger">{test.error}</pre>}
                {test.result && (
                  <pre className="selectable whitespace-pre-wrap break-words rounded-lg bg-hover p-2.5 font-mono text-ink">
                    {JSON.stringify(test.result, null, 2)}
                  </pre>
                )}
                {test.logs.length > 0 && (
                  <pre className="selectable max-h-[140px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line p-2.5 font-mono text-ink-2">
                    {test.logs.join('\n')}
                  </pre>
                )}
                {test.message && (
                  <div>
                    <button className={btn.link} onClick={() => setShowInput(!showInput)}>
                      {showInput ? '입력 msg 숨기기' : '입력 msg 보기'}
                    </button>
                    {showInput && (
                      <pre className="selectable mt-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line p-2.5 font-mono text-[11.5px] text-ink-2">
                        {JSON.stringify({ ...test.message, text: test.message.text && test.message.text.length > 500 ? `${test.message.text.slice(0, 500)}…` : test.message.text }, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
