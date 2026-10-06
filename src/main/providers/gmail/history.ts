// Pure reduction of Gmail history.list records into a change set.

export interface HistoryMessageRef {
  message: { id: string; threadId?: string; labelIds?: string[] }
}

export interface HistoryRecord {
  id: string
  messagesAdded?: HistoryMessageRef[]
  messagesDeleted?: HistoryMessageRef[]
  labelsAdded?: (HistoryMessageRef & { labelIds: string[] })[]
  labelsRemoved?: (HistoryMessageRef & { labelIds: string[] })[]
}

export interface HistoryChangeSet {
  /** new messages: fetch metadata */
  added: string[]
  /** gone: delete locally */
  deleted: string[]
  /** label changes on existing messages: refresh labels (format=minimal) */
  relabeled: string[]
  /** newly arrived messages that are (still) in INBOX (for notifications) */
  inboxAdded: string[]
}

export function reduceHistory(records: HistoryRecord[]): HistoryChangeSet {
  const added = new Set<string>()
  const deleted = new Set<string>()
  const relabeled = new Set<string>()
  const inbox = new Set<string>()
  const sorted = [...records].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  for (const h of sorted) {
    for (const m of h.messagesAdded ?? []) {
      const id = m.message.id
      deleted.delete(id)
      added.add(id)
      if (m.message.labelIds?.includes('INBOX')) inbox.add(id)
    }
    for (const m of h.labelsAdded ?? []) {
      const id = m.message.id
      if (!added.has(id)) relabeled.add(id)
    }
    for (const m of h.labelsRemoved ?? []) {
      const id = m.message.id
      if (!added.has(id)) relabeled.add(id)
      if (m.labelIds.includes('INBOX')) inbox.delete(id)
    }
    for (const m of h.messagesDeleted ?? []) {
      const id = m.message.id
      added.delete(id)
      relabeled.delete(id)
      inbox.delete(id)
      deleted.add(id)
    }
  }
  return { added: [...added], deleted: [...deleted], relabeled: [...relabeled], inboxAdded: [...inbox] }
}
