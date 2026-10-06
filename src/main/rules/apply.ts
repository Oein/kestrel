// Pure mapping between local message state and the rule contract (RuleMessage in, RuleResult out).
import type { InboxCategory, MailboxRole, ProviderKind, RuleResult } from '../../shared/types'
import { computeAfter } from '../actions'
import { isCategoryLabel, mailboxId, type MessageState } from '../db/repo'

export interface MailboxInfo {
  id: string
  remoteId: string
  name: string
  path: string
  role: MailboxRole | null
  type: 'system' | 'user' | 'category'
}

export interface ApplyCtx {
  kind: ProviderKind
  accountId: string
  mailboxes: MailboxInfo[]
}

const CATEGORIES: InboxCategory[] = ['primary', 'promotions', 'social', 'updates']

/** Labels that do not exist yet are tracked under a placeholder id until they are created on the server. */
const NEW = '\u0000new:'
export const placeholderId = (accountId: string, name: string): string => `${accountId}:${NEW}${name}`
export const placeholderName = (id: string): string | null => {
  const i = id.indexOf(NEW)
  return i < 0 ? null : id.slice(i + NEW.length)
}

const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : undefined

/** Validate whatever the rule returned. Returns null for "no-op". Throws on a malformed result. */
export function sanitizeResult(raw: unknown): RuleResult | null {
  if (raw === null || raw === undefined || raw === false) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('규칙은 객체 또는 null을 반환해야 합니다.')
  const o = raw as Record<string, unknown>
  const out: RuleResult = {}
  const add = strList(o.addLabels)
  const remove = strList(o.removeLabels)
  if (add?.length) out.addLabels = add
  if (remove?.length) out.removeLabels = remove
  if (o.category !== undefined && o.category !== null) {
    if (!CATEGORIES.includes(o.category as InboxCategory))
      throw new Error(`category는 ${CATEGORIES.map((c) => `'${c}'`).join(', ')} 중 하나여야 합니다.`)
    out.category = o.category as InboxCategory
  }
  for (const k of ['archive', 'markRead', 'star', 'trash'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return Object.keys(out).length ? out : null
}

/** Find a label / folder by name: user labels by full path (then short name), then system labels (INBOX, IMPORTANT...). */
export function resolveLabel(name: string, ctx: ApplyCtx): string | null {
  const lower = name.toLowerCase()
  const users = ctx.mailboxes.filter((m) => m.type === 'user')
  const hit =
    users.find((m) => m.path.toLowerCase() === lower) ??
    users.find((m) => m.name.toLowerCase() === lower) ??
    ctx.mailboxes.find(
      (m) => m.type === 'system' && (m.remoteId.toLowerCase() === lower || (m.role && m.role.toLowerCase() === lower))
    )
  return hit?.id ?? null
}

/** Label names as rules see them. */
export function labelNames(labels: string[], ctx: ApplyCtx): string[] {
  const byId = new Map(ctx.mailboxes.map((m) => [m.id, m]))
  const out: string[] = []
  for (const id of labels) {
    const ph = placeholderName(id)
    if (ph) {
      out.push(ph)
      continue
    }
    const m = byId.get(id)
    if (!m || m.type === 'category') continue
    out.push(m.type === 'user' ? m.path : (m.role?.toUpperCase() ?? m.remoteId))
  }
  return out
}

/** Inbox category the same way the category tabs compute it (no category label = primary). */
export function categoryOf(labels: string[], accountId: string): InboxCategory | null {
  const cats = labels.filter((l) => isCategoryLabel(accountId, l)).map((l) => l.slice(accountId.length + 1))
  if (cats.includes('CATEGORY_PROMOTIONS')) return 'promotions'
  if (cats.includes('CATEGORY_SOCIAL')) return 'social'
  if (cats.includes('CATEGORY_UPDATES')) return 'updates'
  if (cats.includes('CATEGORY_FORUMS')) return null
  return 'primary'
}

function roleIdOf(ctx: ApplyCtx) {
  return (role: string): string | null =>
    ctx.mailboxes.find((m) => m.role === role)?.id ??
    (ctx.kind === 'gmail' && role === 'inbox' ? mailboxId(ctx.accountId, 'INBOX') : null)
}

/**
 * Apply one rule result to a message state. Gmail: labels are labels, categories are CATEGORY_* labels.
 * IMAP: the first addLabel moves the message into that folder (removeLabels is ignored),
 * categories are local-only labels. Throws ActionError when e.g. an IMAP account has no archive folder.
 */
export function applyRuleResult(state: MessageState, r: RuleResult, ctx: ApplyCtx): MessageState {
  const actx = { kind: ctx.kind, accountId: ctx.accountId, roleId: roleIdOf(ctx) }
  let s: MessageState = { ...state, labels: [...state.labels] }
  const resolve = (name: string): string => resolveLabel(name, ctx) ?? placeholderId(ctx.accountId, name)

  if (r.markRead !== undefined) s = computeAfter({ type: 'read', value: r.markRead }, s, actx)
  if (r.star !== undefined) s = computeAfter({ type: 'star', value: r.star }, s, actx)

  if (r.category) {
    s.labels = s.labels.filter((l) => !isCategoryLabel(ctx.accountId, l))
    if (r.category !== 'primary') s.labels.push(mailboxId(ctx.accountId, `CATEGORY_${r.category.toUpperCase()}`))
    else if (ctx.kind === 'gmail') s.labels.push(mailboxId(ctx.accountId, 'CATEGORY_PERSONAL'))
  }

  if (ctx.kind === 'gmail') {
    for (const name of r.removeLabels ?? []) {
      const id = resolveLabel(name, ctx)
      if (id) s.labels = s.labels.filter((l) => l !== id)
    }
    for (const name of r.addLabels ?? []) {
      const id = resolve(name)
      if (!s.labels.includes(id)) s.labels.push(id)
    }
    if (r.archive) s = computeAfter({ type: 'archive' }, s, actx)
    if (r.trash) s = computeAfter({ type: 'trash' }, s, actx)
  } else {
    if (r.trash) s = computeAfter({ type: 'trash' }, s, actx)
    else if (r.addLabels?.length) s = computeAfter({ type: 'move', mailboxId: resolve(r.addLabels[0]) }, s, actx)
    else if (r.archive) s = computeAfter({ type: 'archive' }, s, actx)
  }
  return s
}

/** Placeholder label names a state still references. */
export function pendingLabels(s: MessageState): string[] {
  return s.labels.map(placeholderName).filter((x): x is string => x !== null)
}
