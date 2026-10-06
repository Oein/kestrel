import { shell, type IpcMain } from 'electron'
import type {
  ActionRequest,
  AppSettings,
  Draft,
  ImapAccountInput,
  OAuthClientInput,
  RuleInput,
  RuleTestRequest,
  View
} from '../shared/types'
import type { Repo } from './db/repo'
import type { MailService } from './mail'
import type { Notifier } from './notify'
import type { OAuthClientService } from './oauthClients'
import type { RuleEngine } from './rules/engine'
import type { SettingsService } from './settings'
import { IMAP_PRESETS } from './providers/imap/presets'

type Handler = (...args: never[]) => unknown

/** Channel names mirror the `window.api` shape: "group.method". */
export function registerIpc(
  ipc: IpcMain,
  repo: Repo,
  mail: MailService,
  oauth: OAuthClientService,
  svc: { settings: SettingsService; rules: RuleEngine; notifier: Notifier }
): void {
  const handlers: Record<string, Handler> = {
    'accounts.list': () => repo.listAccounts(),
    'accounts.addGmail': (opts: { email?: string; oauthClientId?: string }) => mail.addGmail(opts ?? {}),
    'accounts.reauth': (id: string) => mail.reauth(id),
    'accounts.cancelGmailAuth': () => mail.cancelAuth(),
    'accounts.testImap': (input: ImapAccountInput) => mail.testImap(input),
    'accounts.addImap': (input: ImapAccountInput) => mail.addImap(input),
    'accounts.remove': (id: string) => mail.removeAccount(id),
    'accounts.presets': () => IMAP_PRESETS,

    'oauthClients.list': () => oauth.list(),
    'oauthClients.save': (input: OAuthClientInput) => oauth.save(input),
    'oauthClients.remove': (id: string) => oauth.remove(id),
    'oauthClients.setDefault': (id: string) => oauth.setDefault(id),
    'oauthClients.pick': (email: string) => oauth.pick(email),

    'mailboxes.list': () => repo.listMailboxes(),

    'messages.list': (view: View, offset: number, limit: number) => repo.listThreads(view, offset, limit),
    'messages.thread': (id: number) => repo.thread(id),
    'messages.body': (id: number) => mail.getBody(id),
    'messages.prefetch': (ids: number[]) => mail.prefetch(ids),
    'messages.act': (req: ActionRequest) => mail.act(req),
    'messages.undo': (opId: string) => mail.undo(opId),
    'messages.loadMore': (view: View) => mail.loadMore(view),
    'messages.unreadTotal': () => repo.unreadInboxTotal(),

    'search.remote': (query: string, accountId: string | null) => mail.remoteSearch(query, accountId),

    'compose.send': (draft: Draft, delayMs: number) => mail.send(draft, delayMs),
    'compose.undoSend': (opId: string) => mail.undoSend(opId),
    'compose.pickFiles': () => mail.pickFiles(),

    'attachments.open': (id: number, attId: string) => mail.openAttachment(id, attId),
    'attachments.save': (id: number, attId: string) => mail.saveAttachment(id, attId),

    'sync.now': (accountId?: string) => (accountId ? mail.syncAccount(accountId) : mail.syncAll()),
    'sync.statuses': () => mail.getStatuses(),

    'app.openExternal': (url: string) => {
      if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url)
    },
    'app.testNotification': () => svc.notifier.test(),

    'settings.get': () => svc.settings.get(),
    'settings.set': (patch: Partial<AppSettings>) => svc.settings.set(patch ?? {}),

    'rules.list': () => svc.rules.list(),
    'rules.save': (input: RuleInput) => svc.rules.save(input),
    'rules.remove': (id: string) => svc.rules.remove(id),
    'rules.reorder': (ids: string[]) => svc.rules.reorder(ids),
    'rules.test': (req: RuleTestRequest) => svc.rules.test(req ?? {}),
    'rules.runNow': (ruleId?: string) => svc.rules.runNow(ruleId),
    'rules.samples': (limit?: number) => svc.rules.samples(limit)
  }
  for (const [channel, fn] of Object.entries(handlers)) {
    ipc.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
      } catch (e) {
        // errors are returned as values so the renderer gets the clean (Korean) message
        return { ok: false, error: (e as Error).message }
      }
    })
  }
  ipc.on('app.focusChanged', (_e, focused: boolean) => {
    if (focused) mail.onFocus()
  })
}
