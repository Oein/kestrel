import type { MailAction, ProviderKind } from '../shared/types'
import type { MessageState, Repo } from './db/repo'
import { isCategoryLabel, mailboxId } from './db/repo'

export class ActionError extends Error {}

/** Compute the optimistic target state of one message for an action. Pure w.r.t. the given lookups. */
export function computeAfter(
  action: MailAction,
  s: MessageState,
  ctx: { kind: ProviderKind; accountId: string; roleId: (role: string) => string | null }
): MessageState {
  const next: MessageState = { ...s, labels: [...s.labels] }
  const has = (id: string | null): boolean => !!id && next.labels.includes(id)
  const add = (id: string | null): void => {
    if (id && !next.labels.includes(id)) next.labels.push(id)
  }
  const remove = (id: string | null): void => {
    if (id) next.labels = next.labels.filter((l) => l !== id)
  }
  const inbox = ctx.roleId('inbox')
  const trash = ctx.roleId('trash')
  const junk = ctx.roleId('junk')
  const gmail = ctx.kind === 'gmail'
  /** IMAP: a message lives in exactly one folder (+ local-only category labels, which are kept) */
  const moveTo = (target: string | null, missing: string): void => {
    if (!target) throw new ActionError(missing)
    next.labels = [target, ...next.labels.filter((l) => isCategoryLabel(ctx.accountId, l))]
  }

  switch (action.type) {
    case 'read':
      next.isRead = action.value
      break
    case 'star':
      next.isStarred = action.value
      if (gmail) {
        const starred = mailboxId(ctx.accountId, 'STARRED')
        if (action.value) add(starred)
        else remove(starred)
      }
      break
    case 'archive':
      if (gmail) remove(inbox)
      else if (has(inbox)) moveTo(ctx.roleId('archive'), '이 계정에는 보관함 폴더가 없습니다.')
      break
    case 'moveToInbox':
      if (gmail) {
        remove(trash)
        remove(junk)
        add(inbox)
      } else moveTo(inbox, '받은편지함을 찾을 수 없습니다.')
      break
    case 'trash':
      // Gmail drops SPAM when a message is trashed; mirror it so the spam view updates instantly
      if (gmail) {
        add(trash)
        remove(junk)
      }
      else if (!has(trash)) moveTo(trash, '이 계정에는 휴지통 폴더가 없습니다.')
      break
    case 'untrash':
      if (gmail) remove(trash)
      else if (has(trash)) moveTo(inbox, '받은편지함을 찾을 수 없습니다.')
      break
    case 'label':
      if (action.value) add(action.mailboxId)
      else remove(action.mailboxId)
      break
    case 'move':
      if (gmail) {
        remove(inbox)
        remove(trash)
        add(action.mailboxId)
      } else moveTo(action.mailboxId, '폴더를 찾을 수 없습니다.')
      break
  }
  return next
}

export function sameState(a: MessageState, b: MessageState): boolean {
  if (a.isRead !== b.isRead || a.isStarred !== b.isStarred) return false
  if (a.labels.length !== b.labels.length) return false
  const set = new Set(a.labels)
  return b.labels.every((l) => set.has(l))
}

/**
 * Expand representative ids to the message ids an action should affect (Gmail-like conversation semantics).
 * For IMAP, folder moves only affect messages in the same folder as the representative,
 * so replying in Sent is never moved by archiving an inbox conversation.
 */
export function expandTargets(repo: Repo, repIds: number[], action: MailAction, expand: boolean): number[] {
  const out = new Set<number>()
  for (const id of repIds) {
    if (!expand || (action.type === 'star' && action.value)) {
      out.add(id)
      continue
    }
    const ref = repo.ref(id)
    if (!ref) continue
    const account = repo.accountRow(ref.accountId)
    const thread = repo.threadMessageIds(id)
    const isMove = !['read', 'star', 'label'].includes(action.type)
    if (account?.provider === 'imap' && isMove) {
      const repLabels = new Set((repo.states([id])[0]?.labels ?? []).filter((l) => !isCategoryLabel(ref.accountId, l)))
      for (const st of repo.states(thread)) if (st.labels.some((l) => repLabels.has(l))) out.add(st.id)
    } else if (action.type === 'star') {
      // unstar: every starred message of the conversation
      for (const st of repo.states(thread)) if (st.isStarred) out.add(st.id)
      out.add(id)
    } else {
      for (const t of thread) out.add(t)
    }
  }
  return [...out]
}
