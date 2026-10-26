// Types shared between main, preload and renderer.

export type ProviderKind = 'gmail' | 'imap'
export type ImapPreset = 'icloud' | 'naver' | 'custom'

export type MailboxRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'archive'
  | 'junk'
  | 'starred'
  | 'important'
  | 'all'

export type InboxCategory = 'primary' | 'promotions' | 'social' | 'updates'

export interface Account {
  id: string
  provider: ProviderKind
  preset: ImapPreset | 'gmail'
  email: string
  name: string
  color: string
  oauthClientId: string | null
  needsReauth: boolean
}

export interface OAuthClient {
  id: string
  name: string
  clientId: string
  hasSecret: boolean
  domains: string[] // e.g. ["school.ac.kr"]
  isDefault: boolean
  accountCount: number
}

export interface OAuthClientInput {
  id?: string // present when editing
  name: string
  clientId: string
  /** empty string when editing = keep the stored secret */
  clientSecret: string
  domains: string[]
  isDefault: boolean
}

export interface ImapServerConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS, false = STARTTLS
}

export interface ImapAccountInput {
  preset: ImapPreset
  email: string
  name: string
  username: string
  password: string
  imap: ImapServerConfig
  smtp: ImapServerConfig
}

export interface Mailbox {
  id: string // `${accountId}:${remoteId}`
  accountId: string
  remoteId: string
  name: string
  path: string // full display path ("Work/Projects")
  role: MailboxRole | null
  type: 'system' | 'user' | 'category'
  colorBg: string | null
  colorText: string | null
  unread: number
}

export interface Address {
  name: string
  email: string
}

export interface AttachmentInfo {
  id: string // provider-specific: gmail attachmentId / imap part number
  filename: string
  mimeType: string
  size: number
  contentId?: string | null
  inline?: boolean
}

/** One row in the message list (a conversation, represented by its latest message). */
export interface ThreadRow {
  id: number // representative (latest) message id
  accountId: string
  threadId: string
  subject: string
  from: Address
  participants: string // short names joined
  snippet: string
  date: number
  unread: boolean
  starred: boolean
  hasAttachments: boolean
  attachments: AttachmentInfo[]
  count: number
  labelIds: string[] // user label mailbox ids
}

export interface MessageMeta {
  id: number
  accountId: string
  remoteId: string
  threadId: string
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  replyTo: Address[]
  date: number
  snippet: string
  unread: boolean
  starred: boolean
  hasAttachments: boolean
  attachments: AttachmentInfo[]
  messageIdHeader: string | null
  inReplyTo: string | null
  references: string | null
  labelIds: string[]
}

export interface MessageBody {
  html: string | null
  text: string | null
  attachments: AttachmentInfo[]
}

export type View = (
  | { kind: 'role'; role: MailboxRole; accountId: string | null; category?: InboxCategory }
  | { kind: 'label'; mailboxId: string; accountId: string }
  | { kind: 'search'; query: string; accountId: string | null; token?: string }
) & {
  /** only conversations with at least one unread message */
  unreadOnly?: boolean
}

export type MailAction =
  | { type: 'read'; value: boolean }
  | { type: 'star'; value: boolean }
  | { type: 'archive' }
  | { type: 'moveToInbox' }
  | { type: 'trash' }
  | { type: 'untrash' }
  | { type: 'label'; mailboxId: string; value: boolean }
  | { type: 'move'; mailboxId: string }

export interface ActionRequest {
  action: MailAction
  messageIds: number[] // representative ids; main expands to whole threads
  expandThreads: boolean
  /** delay before committing to server (ms) — enables undo */
  delayMs?: number
}

export interface DraftAttachment {
  path: string
  filename: string
  size: number
}

export interface Draft {
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string // plain text authored by user
  quotedHtml?: string | null
  inReplyTo?: string | null
  references?: string | null
  threadId?: string | null
  attachments: DraftAttachment[]
}

export interface SyncStatus {
  accountId: string
  state: 'idle' | 'syncing' | 'error' | 'offline'
  message?: string
  lastSync?: number
}

export interface ToastEvent {
  kind: 'info' | 'error' | 'success'
  message: string
}

export interface DownloadProgress {
  /** unique per download */
  id: string
  kind: 'open' | 'save'
  filename: string
  /** decoded bytes received so far (estimated for Gmail) */
  loaded: number
  /** 0 when unknown */
  total: number
  /** bytes/s over the last ~second */
  rate: number
  state: 'active' | 'done' | 'error'
}

export interface ImapTestResult {
  ok: boolean
  imap: string | null // error message, null if ok
  smtp: string | null
}

export interface ListResult {
  rows: ThreadRow[]
  hasMore: boolean
}

export interface ImapPresetInfo {
  id: ImapPreset
  label: string
  imap: ImapServerConfig
  smtp: ImapServerConfig
  hint: string
  link?: string
}

export interface AppEvents {
  'mail:changed': { accountIds: string[] }
  'mailboxes:changed': { accountId: string }
  'accounts:changed': Record<string, never>
  'sync:status': SyncStatus
  toast: ToastEvent
  'open-message': { messageId: number }
  'search:updated': { token: string }
  'op:reverted': { opId: string; reason: string }
  'compose:restore': Draft
  /** ⌘, (app menu) or the tray asks the renderer to open settings, optionally at a tab id (e.g. 'general', 'rules') */
  'app:openSettings': { tab?: string }
  /** tray / app menu "새 메일" */
  'app:compose': Record<string, never>
  'settings:changed': AppSettings
  /** rule list/stats changed (saved, removed, run finished) */
  'rules:changed': Record<string, never>
  /** attachment download progress; throttled, first event only after a short delay */
  download: DownloadProgress
}

// ---------- app settings ----------
export interface AppSettings {
  /** 새 메일 알림 */
  notifications: boolean
  /** 로그인 시 자동 실행 (only takes effect in a packaged/signed build) */
  launchAtLogin: boolean
  /** 창을 닫으면 메뉴바에 남기기 (tray icon + keep syncing); off = closing the window quits */
  keepInMenuBar: boolean
}

// ---------- auto-categorization rules ----------
export type RuleLanguage = 'js' | 'python'

export interface Rule {
  id: string
  name: string
  enabled: boolean
  language: RuleLanguage
  code: string
  /** null = all accounts */
  accountId: string | null
  sort: number
  createdAt: number
  lastError: string | null
  lastRunAt: number | null
  hitCount: number
}

export interface RuleInput {
  id?: string // present when editing
  name: string
  enabled: boolean
  language: RuleLanguage
  code: string
  accountId: string | null
}

/** The JSON object a rule receives. */
export interface RuleMessage {
  id: number
  account: { id: string; email: string; provider: ProviderKind }
  from: Address
  to: Address[]
  cc: Address[]
  subject: string
  snippet: string
  /** plain-text body when it is cached locally, else null */
  text: string | null
  date: number
  /** user label / folder names (full path) and system labels in upper case (INBOX, STARRED, IMPORTANT, ...) */
  labels: string[]
  category: InboxCategory | null
  unread: boolean
  starred: boolean
  hasAttachments: boolean
  attachments: { filename: string; mimeType: string; size: number }[]
}

/** What a rule returns (null / {} = no-op). */
export interface RuleResult {
  addLabels?: string[]
  removeLabels?: string[]
  category?: InboxCategory
  archive?: boolean
  markRead?: boolean
  star?: boolean
  trash?: boolean
}

export interface RuleTestRequest {
  /** test a saved rule ... */
  ruleId?: string
  /** ... or unsaved code from the editor */
  language?: RuleLanguage
  code?: string
  /** message to test against; default = most recent inbox message */
  messageId?: number
}

export interface RuleTestResult {
  message: RuleMessage | null
  result: RuleResult | null
  error: string | null
  /** console.log / print output */
  logs: string[]
  ms: number
}

export interface RuleRunSummary {
  processed: number
  /** messages whose state changed */
  changed: number
  errors: string[]
}

export interface RuleSampleMessage {
  id: number
  accountId: string
  subject: string
  from: Address
  date: number
}

export interface MailApi {
  accounts: {
    list(): Promise<Account[]>
    addGmail(opts: { email?: string; oauthClientId?: string }): Promise<Account>
    reauth(accountId: string): Promise<Account>
    cancelGmailAuth(): Promise<void>
    testImap(input: ImapAccountInput): Promise<ImapTestResult>
    addImap(input: ImapAccountInput): Promise<Account>
    remove(accountId: string): Promise<void>
    presets(): Promise<ImapPresetInfo[]>
  }
  oauthClients: {
    list(): Promise<OAuthClient[]>
    save(input: OAuthClientInput): Promise<OAuthClient>
    remove(id: string): Promise<void>
    setDefault(id: string): Promise<void>
    /** client that would be picked for an email address (domain match, else default) */
    pick(email: string): Promise<string | null>
  }
  mailboxes: {
    list(): Promise<Mailbox[]>
  }
  messages: {
    list(view: View, offset: number, limit: number): Promise<ListResult>
    thread(messageId: number): Promise<MessageMeta[]>
    body(messageId: number): Promise<MessageBody>
    prefetch(messageIds: number[]): Promise<void>
    act(req: ActionRequest): Promise<{ opId: string }>
    undo(opId: string): Promise<boolean>
    loadMore(view: View): Promise<number>
    unreadTotal(): Promise<number>
  }
  search: {
    remote(query: string, accountId: string | null): Promise<string>
  }
  compose: {
    send(draft: Draft, delayMs: number): Promise<{ opId: string }>
    undoSend(opId: string): Promise<Draft | null>
    pickFiles(): Promise<DraftAttachment[]>
  }
  attachments: {
    open(messageId: number, attachmentId: string): Promise<void>
    save(messageId: number, attachmentId: string): Promise<void>
  }
  sync: {
    now(accountId?: string): Promise<void>
    statuses(): Promise<SyncStatus[]>
  }
  app: {
    openExternal(url: string): Promise<void>
    focusChanged(focused: boolean): void
    /** show a sample new-mail notification (ignores focus / the notifications setting) */
    testNotification(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  rules: {
    list(): Promise<Rule[]>
    save(input: RuleInput): Promise<Rule>
    remove(id: string): Promise<void>
    /** full ordered list of rule ids */
    reorder(ids: string[]): Promise<void>
    /** run a rule (saved or draft code) on one message without applying anything */
    test(req: RuleTestRequest): Promise<RuleTestResult>
    /** apply enabled rules (or just `ruleId`) to the latest 500 inbox messages */
    runNow(ruleId?: string): Promise<RuleRunSummary>
    /** recent inbox messages to pick a test message from */
    samples(limit?: number): Promise<RuleSampleMessage[]>
  }
  on<K extends keyof AppEvents>(channel: K, cb: (payload: AppEvents[K]) => void): () => void
}

export const ACCOUNT_COLORS = [
  '#4f86f7',
  '#e8710a',
  '#1e8e3e',
  '#d93025',
  '#9334e6',
  '#12a4af',
  '#f538a0',
  '#b06000'
]
