import type { AttachmentInfo, Draft, MessageBody } from '../../shared/types'
import type { LocalMessageRef, MessageState } from '../db/repo'

export interface StateChange {
  ref: LocalMessageRef
  before: MessageState
  after: MessageState
}

export interface FetchedBody extends MessageBody {
  /** plain text used for the search index */
  plain: string
  snippet: string
}

export interface SyncOutcome {
  /** local ids of messages that newly arrived in the inbox (read or unread; for rules and notifications) */
  newInboxIds: number[]
  changed: boolean
}

export interface SendEnvelope {
  from: string
  to: string[]
}

/**
 * Provider abstraction. Implementations write into the local Repo themselves
 * (sync/search/backfill) so the UI can render from SQLite at all times.
 */
export interface MailProvider {
  readonly accountId: string
  readonly kind: 'gmail' | 'imap'
  /** open connections / validate credentials */
  connect(): Promise<void>
  close(): Promise<void>
  /** refresh folder / label list into the Repo */
  syncFolders(): Promise<void>
  /** incremental sync (falls back to initial sync when no state exists) */
  sync(): Promise<SyncOutcome>
  /** load older messages of a mailbox (null = inbox). Returns number of messages added. */
  backfill(mailboxId: string | null): Promise<number>
  fetchBodies(refs: LocalMessageRef[]): Promise<Map<number, FetchedBody>>
  /** `onProgress` receives decoded bytes received so far */
  fetchAttachment(ref: LocalMessageRef, att: AttachmentInfo, onProgress?: (loaded: number) => void): Promise<Buffer>
  /** push local optimistic state changes to the server */
  applyChanges(changes: StateChange[]): Promise<void>
  send(raw: Buffer, draft: Draft, envelope: SendEnvelope): Promise<void>
  /** server-side search; returns local ids (messages are stored locally as needed) */
  search(query: string): Promise<number[]>
  /** rules: local mailbox id for a user label / folder name, creating it on the server when missing */
  ensureLabel(name: string): Promise<string>
  /** start realtime watching; callback triggers an incremental sync */
  watch(onChange: () => void): void
}
