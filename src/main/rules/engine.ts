// Auto-categorization rules: storage, running (JS sandbox / Python) and applying results to messages.
import { randomUUID } from 'crypto'
import type {
  AppEvents,
  Rule,
  RuleInput,
  RuleMessage,
  RuleRunSummary,
  RuleSampleMessage,
  RuleTestRequest,
  RuleTestResult
} from '../../shared/types'
import { sameState } from '../actions'
import type { MessageState, Repo } from '../db/repo'
import { htmlToText } from '../mime'
import type { StateChange } from '../providers/types'
import { applyRuleResult, categoryOf, labelNames, pendingLabels, placeholderId, sanitizeResult, type ApplyCtx } from './apply'
import type { BatchOutcome } from './jsSandbox'

export interface RuleRunner {
  run(code: string, inputs: string[], timeoutMs: number): Promise<BatchOutcome>
}

type Emit = <K extends keyof AppEvents>(channel: K, payload: AppEvents[K]) => void

export interface RuleEngineDeps {
  js: RuleRunner
  python: RuleRunner
  /** label/folder id for a name, created on the server when missing */
  ensureLabel(accountId: string, name: string): Promise<string>
  /** apply the changes locally and push them to the server (existing action/commit machinery) */
  commit(changes: Map<string, StateChange[]>): void
  emit: Emit
}

export const TIMEOUT_MS = { js: 200, python: 500 } as const
export const RUN_NOW_LIMIT = 500

interface Item {
  id: number
  accountId: string
  ctx: ApplyCtx
  before: MessageState
  state: MessageState
  msg: RuleMessage
}

export class RuleEngine {
  constructor(
    private repo: Repo,
    private deps: RuleEngineDeps
  ) {}

  // ---------- CRUD ----------
  list(): Rule[] {
    return this.repo.listRules()
  }

  save(input: RuleInput): Rule {
    const name = input.name.trim() || '새 규칙'
    if (input.language !== 'js' && input.language !== 'python') throw new Error('지원하지 않는 언어입니다.')
    if (input.accountId && !this.repo.accountRow(input.accountId)) throw new Error('계정을 찾을 수 없습니다.')
    const id = input.id ?? randomUUID()
    this.repo.upsertRule({ id, name, enabled: input.enabled, language: input.language, code: input.code, accountId: input.accountId })
    this.deps.emit('rules:changed', {})
    return this.repo.rule(id)!
  }

  remove(id: string): void {
    this.repo.deleteRule(id)
    this.deps.emit('rules:changed', {})
  }

  reorder(ids: string[]): void {
    this.repo.reorderRules(ids)
    this.deps.emit('rules:changed', {})
  }

  samples(limit = 30): RuleSampleMessage[] {
    return this.repo.ruleSamples(Math.min(Math.max(limit, 1), 200))
  }

  // ---------- message JSON ----------
  private ctxCache = new Map<string, ApplyCtx>()
  private ctxFor(accountId: string): ApplyCtx | null {
    const cached = this.ctxCache.get(accountId)
    if (cached) return cached
    const acc = this.repo.accountRow(accountId)
    if (!acc) return null
    const ctx: ApplyCtx = {
      kind: acc.provider,
      accountId,
      mailboxes: this.repo.mailboxInfos(accountId).map((m) => ({
        id: m.id,
        remoteId: m.remote_id,
        name: m.name,
        path: m.path,
        role: m.role,
        type: m.type
      }))
    }
    this.ctxCache.set(accountId, ctx)
    return ctx
  }

  private buildItems(ids: number[]): Item[] {
    this.ctxCache.clear()
    const states = new Map(this.repo.states(ids).map((s) => [s.id, s]))
    const items: Item[] = []
    for (const id of ids) {
      const meta = this.repo.meta(id)
      const st = states.get(id)
      if (!meta || !st) continue
      const ctx = this.ctxFor(meta.accountId)
      const acc = this.repo.accountRow(meta.accountId)
      if (!ctx || !acc) continue
      const body = this.repo.getBody(id)
      const text = body ? (body.text ?? (body.html ? htmlToText(body.html) : null)) : null
      const msg: RuleMessage = {
        id,
        account: { id: acc.id, email: acc.email, provider: acc.provider },
        from: meta.from,
        to: meta.to,
        cc: meta.cc,
        subject: meta.subject,
        snippet: meta.snippet,
        text: text ? text.slice(0, 20_000) : null,
        date: meta.date,
        labels: labelNames(st.labels, ctx),
        category: categoryOf(st.labels, ctx.accountId),
        unread: !st.isRead,
        starred: st.isStarred,
        hasAttachments: meta.hasAttachments,
        attachments: meta.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size }))
      }
      items.push({ id, accountId: meta.accountId, ctx, before: st, state: { ...st, labels: [...st.labels] }, msg })
    }
    return items
  }

  private runner(lang: Rule['language']): RuleRunner {
    return lang === 'python' ? this.deps.python : this.deps.js
  }

  // ---------- test ----------
  async test(req: RuleTestRequest): Promise<RuleTestResult> {
    const saved = req.ruleId ? this.repo.rule(req.ruleId) : undefined
    if (req.ruleId && !saved) throw new Error('규칙을 찾을 수 없습니다.')
    const language = req.language ?? saved?.language ?? 'js'
    const code = req.code ?? saved?.code ?? ''
    const id = req.messageId ?? this.repo.recentInboxIds(1)[0]
    const item = id !== undefined ? this.buildItems([id])[0] : undefined
    if (!item) return { message: null, result: null, error: '테스트할 메일이 없습니다.', logs: [], ms: 0 }
    const t0 = performance.now()
    const out = await this.runner(language).run(code, [JSON.stringify(item.msg)], TIMEOUT_MS[language])
    const ms = Math.round(performance.now() - t0)
    if (out.fatal) return { message: item.msg, result: null, error: out.fatal, logs: [], ms }
    const o = out.outcomes[0]
    if (!o) return { message: item.msg, result: null, error: '결과가 없습니다.', logs: [], ms }
    if (o.error) return { message: item.msg, result: null, error: o.error, logs: o.logs, ms }
    try {
      return { message: item.msg, result: sanitizeResult(o.result), error: null, logs: o.logs, ms }
    } catch (e) {
      return { message: item.msg, result: null, error: (e as Error).message, logs: o.logs, ms }
    }
  }

  // ---------- apply ----------
  hasEnabledRules(): boolean {
    return this.repo.listRules().some((r) => r.enabled && r.code.trim())
  }

  /** Called by sync with newly arrived inbox messages (before notifications). Never throws. */
  async onNewMessages(accountId: string, ids: number[]): Promise<void> {
    if (!ids.length || !this.hasEnabledRules()) return
    try {
      const sum = await this.apply(ids, {})
      if (sum.errors.length) console.warn(`[rules ${accountId}]`, sum.errors.join(' | '))
    } catch (e) {
      console.warn('[rules] apply failed', (e as Error).message)
    }
  }

  /** "지금 받은편지함에 적용": latest inbox messages, all enabled rules or one rule (even if disabled). */
  runNow(ruleId?: string): Promise<RuleRunSummary> {
    const rule = ruleId ? this.repo.rule(ruleId) : undefined
    if (ruleId && !rule) throw new Error('규칙을 찾을 수 없습니다.')
    return this.apply(this.repo.recentInboxIds(RUN_NOW_LIMIT, rule?.accountId), { ruleId })
  }

  private async apply(ids: number[], opts: { ruleId?: string }): Promise<RuleRunSummary> {
    const rules = this.repo
      .listRules()
      .filter((r) => (opts.ruleId ? r.id === opts.ruleId : r.enabled) && r.code.trim())
    const errors: string[] = []
    if (!rules.length || !ids.length) return { processed: 0, changed: 0, errors }
    const items = this.buildItems(ids)

    for (const rule of rules) {
      const targets = items.filter((it) => !rule.accountId || it.accountId === rule.accountId)
      if (!targets.length) continue
      let out: BatchOutcome
      try {
        out = await this.runner(rule.language).run(rule.code, targets.map((t) => JSON.stringify(t.msg)), TIMEOUT_MS[rule.language])
      } catch (e) {
        out = { fatal: (e as Error).message, outcomes: [] }
      }
      if (out.fatal) {
        errors.push(`${rule.name}: ${out.fatal}`)
        this.repo.recordRuleRun(rule.id, { error: out.fatal, hits: 0 })
        continue
      }
      let firstError: string | null = null
      let hits = 0
      targets.forEach((it, i) => {
        const o = out.outcomes[i]
        if (!o) return
        try {
          if (o.error) throw new Error(o.error)
          const r = sanitizeResult(o.result)
          if (!r) return
          hits++
          it.state = applyRuleResult(it.state, r, it.ctx)
          // later rules see this rule's effects
          it.msg.labels = labelNames(it.state.labels, it.ctx)
          it.msg.category = categoryOf(it.state.labels, it.accountId)
          it.msg.unread = !it.state.isRead
          it.msg.starred = it.state.isStarred
        } catch (e) {
          firstError ??= `${(e as Error).message} — "${it.msg.subject || '(제목 없음)'}"`
        }
      })
      if (firstError) errors.push(`${rule.name}: ${firstError}`)
      this.repo.recordRuleRun(rule.id, { error: firstError, hits })
    }

    // create labels / folders that rules asked for but do not exist yet
    const wanted = new Map<string, Set<string>>()
    for (const it of items) for (const n of pendingLabels(it.state)) wanted.set(it.accountId, (wanted.get(it.accountId) ?? new Set()).add(n))
    const created = new Map<string, string | null>()
    for (const [accountId, names] of wanted) {
      for (const name of names) {
        try {
          created.set(placeholderId(accountId, name), await this.deps.ensureLabel(accountId, name))
        } catch (e) {
          created.set(placeholderId(accountId, name), null)
          errors.push(`라벨 "${name}"을(를) 만들지 못했습니다: ${(e as Error).message}`)
        }
      }
      this.deps.emit('mailboxes:changed', { accountId })
    }

    const changes = new Map<string, StateChange[]>()
    const refs = new Map(this.repo.refs(items.map((i) => i.id)).map((r) => [r.id, r]))
    for (const it of items) {
      let after = it.state
      if (pendingLabels(after).length) {
        const failed = after.labels.some((l) => created.get(l) === null)
        if (failed && it.ctx.kind === 'imap') after = { ...after, labels: it.before.labels } // move target missing: stay put
        else after = { ...after, labels: after.labels.map((l) => created.get(l) ?? l).filter((l) => created.get(l) !== null) }
      }
      if (sameState(it.before, after)) continue
      const ref = refs.get(it.id)
      if (!ref) continue
      if (it.ctx.kind === 'imap' && after.labels.some((l) => l.startsWith(`${it.accountId}:CATEGORY_`))) {
        if (this.repo.ensureLocalCategories(it.accountId)) this.deps.emit('mailboxes:changed', { accountId: it.accountId })
      }
      changes.set(it.accountId, [...(changes.get(it.accountId) ?? []), { ref, before: it.before, after }])
    }
    const changed = [...changes.values()].reduce((n, l) => n + l.length, 0)
    if (changed) this.deps.commit(changes)
    this.deps.emit('rules:changed', {})
    return { processed: items.length, changed, errors }
  }
}
