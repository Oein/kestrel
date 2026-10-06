import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvents, MailApi } from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; error: string }
  if (!res.ok) throw new Error(res.error)
  return res.value
}

const c =
  (channel: string) =>
  (...args: unknown[]) =>
    call(channel, ...args)

const api: MailApi = {
  accounts: {
    list: c('accounts.list'),
    addGmail: c('accounts.addGmail'),
    reauth: c('accounts.reauth'),
    cancelGmailAuth: c('accounts.cancelGmailAuth'),
    testImap: c('accounts.testImap'),
    addImap: c('accounts.addImap'),
    remove: c('accounts.remove'),
    presets: c('accounts.presets')
  } as MailApi['accounts'],
  oauthClients: {
    list: c('oauthClients.list'),
    save: c('oauthClients.save'),
    remove: c('oauthClients.remove'),
    setDefault: c('oauthClients.setDefault'),
    pick: c('oauthClients.pick')
  } as MailApi['oauthClients'],
  mailboxes: { list: c('mailboxes.list') } as MailApi['mailboxes'],
  messages: {
    list: c('messages.list'),
    thread: c('messages.thread'),
    body: c('messages.body'),
    prefetch: c('messages.prefetch'),
    act: c('messages.act'),
    undo: c('messages.undo'),
    loadMore: c('messages.loadMore'),
    unreadTotal: c('messages.unreadTotal')
  } as MailApi['messages'],
  search: { remote: c('search.remote') } as MailApi['search'],
  compose: {
    send: c('compose.send'),
    undoSend: c('compose.undoSend'),
    pickFiles: c('compose.pickFiles')
  } as MailApi['compose'],
  attachments: { open: c('attachments.open'), save: c('attachments.save') } as MailApi['attachments'],
  sync: { now: c('sync.now'), statuses: c('sync.statuses') } as MailApi['sync'],
  app: {
    openExternal: c('app.openExternal'),
    focusChanged: (focused: boolean) => ipcRenderer.send('app.focusChanged', focused),
    testNotification: c('app.testNotification')
  } as MailApi['app'],
  settings: { get: c('settings.get'), set: c('settings.set') } as MailApi['settings'],
  rules: {
    list: c('rules.list'),
    save: c('rules.save'),
    remove: c('rules.remove'),
    reorder: c('rules.reorder'),
    test: c('rules.test'),
    runNow: c('rules.runNow'),
    samples: c('rules.samples')
  } as MailApi['rules'],
  on<K extends keyof AppEvents>(channel: K, cb: (payload: AppEvents[K]) => void): () => void {
    const listener = (_e: unknown, payload: AppEvents[K]): void => cb(payload)
    ipcRenderer.on(`event:${channel}`, listener)
    return () => ipcRenderer.removeListener(`event:${channel}`, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
