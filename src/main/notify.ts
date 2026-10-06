// New-mail macOS notifications.
import { Notification, type BrowserWindow } from 'electron'
import type { AppEvents, MessageMeta } from '../shared/types'
import type { Repo } from './db/repo'

type Emit = <K extends keyof AppEvents>(channel: K, payload: AppEvents[K]) => void

/** More than this many new messages at once → one summary notification. */
export const BURST = 3

export type NotificationPlan =
  | { kind: 'each'; items: { id: number; title: string; subtitle: string; body: string }[] }
  | { kind: 'summary'; title: string; body: string; newestId: number }

const sender = (m: Pick<MessageMeta, 'from'>): string => m.from.name || m.from.email || '(보낸 사람 없음)'

/** Pure: what to show for a set of new messages (newest first). */
export function planNotifications(metas: Pick<MessageMeta, 'id' | 'from' | 'subject' | 'snippet'>[]): NotificationPlan | null {
  if (!metas.length) return null
  if (metas.length > BURST) {
    const names = [...new Set(metas.map(sender))]
    return {
      kind: 'summary',
      title: `새 메일 ${metas.length}통`,
      body: names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}명` : ''),
      newestId: metas[0].id
    }
  }
  return {
    kind: 'each',
    items: metas.map((m) => ({ id: m.id, title: sender(m), subtitle: m.subject || '(제목 없음)', body: m.snippet }))
  }
}

export class Notifier {
  /** ids already notified (a message can re-appear in the inbox; notify once) */
  private seen = new Set<number>()
  /** keep references so click handlers survive GC */
  private live = new Set<Notification>()

  constructor(
    private repo: Repo,
    private enabled: () => boolean,
    private getWindow: () => BrowserWindow | null,
    private showWindow: () => void,
    private emit: Emit
  ) {}

  notify(ids: number[]): void {
    if (!this.enabled() || !Notification.isSupported()) return
    const win = this.getWindow()
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return
    // still unread, still in an inbox (rules may have archived / read / trashed it), not notified before
    const fresh = this.repo.notifiableIds(ids).filter((id) => !this.seen.has(id))
    fresh.forEach((id) => this.seen.add(id))
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000))
    const metas = fresh.map((id) => this.repo.meta(id)).filter((m): m is MessageMeta => !!m)
    const plan = planNotifications(metas)
    if (!plan) return
    if (plan.kind === 'summary') this.show({ title: plan.title, body: plan.body }, null)
    else for (const it of plan.items) this.show({ title: it.title, subtitle: it.subtitle, body: it.body }, it.id)
  }

  /** "테스트 알림 보내기": always shows, using the latest inbox message when there is one. */
  test(): void {
    if (!Notification.isSupported()) throw new Error('이 시스템에서는 알림을 사용할 수 없습니다.')
    const id = this.repo.recentInboxIds(1)[0]
    const m = id !== undefined ? this.repo.meta(id) : undefined
    if (m) this.show({ title: sender(m), subtitle: m.subject || '(제목 없음)', body: m.snippet || '테스트 알림입니다.' }, m.id)
    else this.show({ title: 'Mailbird', body: '테스트 알림입니다. 새 메일이 오면 이렇게 알려 드려요.' }, null)
  }

  private show(opts: { title: string; subtitle?: string; body: string }, messageId: number | null): void {
    const n = new Notification({ ...opts, body: opts.body.slice(0, 240), silent: false })
    const done = (): void => {
      this.live.delete(n)
    }
    n.on('click', () => {
      done()
      this.showWindow()
      if (messageId !== null) this.emit('open-message', { messageId })
    })
    n.on('close', done)
    this.live.add(n)
    if (this.live.size > 30) this.live.delete(this.live.values().next().value!)
    n.show()
  }
}
