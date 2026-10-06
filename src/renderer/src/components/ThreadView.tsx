import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AttachmentInfo, MessageBody, MessageMeta } from '../../../shared/types'
import { displayName, fileSize, formatAddr, longDate, relative } from '../lib/format'
import { linkify, prepareHtml } from '../lib/sanitize'
import { act, api, cachedBody, fetchBody, onBodies, openThread, reply, threadListeners, toast, useStore } from '../store'
import { Icon } from './Icon'
import { useLayout } from '../lib/layout'
import { setRegion } from '../lib/selection'
import { AccountMark, Avatar, cx, IconButton, LabelChip } from './ui'

function useBody(id: number, enabled: boolean): { body: MessageBody | undefined; error: string | null } {
  const [, force] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => onBodies(() => force((n) => n + 1)), [])
  useEffect(() => {
    if (!enabled || cachedBody(id)) return
    setError(null)
    fetchBody(id).catch((e: Error) => setError(e.message))
  }, [id, enabled])
  return { body: cachedBody(id), error }
}

/** Sandboxed iframe (no scripts) that auto-sizes to its content. */
function HtmlFrame({ doc }: { doc: string }): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)

  const onLoad = useCallback(() => {
    const f = ref.current
    const d = f?.contentDocument
    if (!f || !d) return
    // body height (not scrollHeight of the viewport) avoids a grow-forever feedback loop
    const measure = (): void => {
      const h = Math.max(40, Math.ceil(d.body.getBoundingClientRect().height) + 4)
      setHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev))
    }
    measure()
    let raf = 0
    // use the frame's own ResizeObserver: observing a cross-document node from the parent realm loops forever
    const FrameRO = (f.contentWindow as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver
    const ro = new FrameRO(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    ro.observe(d.body)
    d.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure))
    // open every link in the system browser
    d.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) void api.app.openExternal(href)
    })
    d.addEventListener('mousedown', () => setRegion('thread'))
    // forward keyboard shortcuts to the app while the frame has focus; ⌘A/⌘C stay native (select/copy the mail text)
    d.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !['Backspace', 'Delete', 'k', 'K', ',', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) return
      window.dispatchEvent(new KeyboardEvent('keydown', e))
    })
  }, [])

  return (
    <iframe
      ref={ref}
      title="메일 본문"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      onLoad={onLoad}
      style={{ height }}
      className="block w-full border-0 bg-transparent"
    />
  )
}


function useDark(): boolean {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

function Attachments({ messageId, list }: { messageId: number; list: AttachmentInfo[] }): React.JSX.Element | null {
  const visible = list.filter((a) => !a.inline)
  if (!visible.length) return null
  return (
    <div className="mt-5">
      <div className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-3">첨부파일 {visible.length}개</div>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => {
          const ext = (a.filename.split('.').pop() ?? '').slice(0, 4).toUpperCase()
          return (
            <div key={a.id} className="group flex w-[232px] items-center gap-2.5 rounded-lg border border-line bg-surface p-2 pr-1.5 transition-colors hover:border-line-strong">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hover text-[9.5px] font-bold tracking-wide text-ink-2">
                {a.mimeType.startsWith('image/') ? <Icon name="image" size={15} /> : ext || <Icon name="attach" size={15} />}
              </span>
              <button
                className="min-w-0 flex-1 text-left"
                title={`열기 — ${a.filename}`}
                onClick={() => api.attachments.open(messageId, a.id).catch((e: Error) => toast('error', e.message))}
              >
                <div className="truncate text-[12.5px] font-medium text-ink">{a.filename}</div>
                <div className="tnum text-[11px] text-ink-3">{fileSize(a.size)}</div>
              </button>
              <IconButton
                icon="download"
                title="다운로드"
                size="sm"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void api.attachments.save(messageId, a.id).catch((e: Error) => toast('error', e.message))}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MessageCard({ m, expanded, onToggle, isLast }: { m: MessageMeta; expanded: boolean; onToggle: () => void; isLast: boolean }): React.JSX.Element {
  const { body, error } = useBody(m.id, expanded)
  const [allowRemote, setAllowRemote] = useState(false)
  const [original, setOriginal] = useState(false)
  const dark = useDark()
  const accounts = useStore((s) => s.accounts)
  const me = accounts.find((a) => a.id === m.accountId)
  const prepared = useMemo(
    () => (body?.html ? prepareHtml(body.html, allowRemote, dark && !original) : null),
    [body?.html, allowRemote, dark, original]
  )

  if (!expanded) {
    return (
      <button onClick={onToggle} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover">
        <Avatar addr={m.from} size={26} />
        <span className={cx('w-36 shrink-0 truncate text-[13px]', m.unread ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{displayName(m.from)}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{m.snippet}</span>
        <span className="tnum shrink-0 text-[11.5px] text-ink-3">{relative(m.date)}</span>
      </button>
    )
  }

  const recipients = [...m.to, ...m.cc]
  const paper = prepared?.mode === 'paper' || (dark && original && !!prepared)
  return (
    <article className={cx('animate-fade px-3 py-4', !isLast && 'border-b border-line')}>
      <header className="flex items-start gap-3">
        <Avatar addr={m.from} size={34} />
        <div className="min-w-0 flex-1 cursor-default" onClick={isLast ? undefined : onToggle}>
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-semibold text-ink">{displayName(m.from)}</span>
            {m.from.name && <span className="selectable truncate text-[12px] text-ink-3">{m.from.email}</span>}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-3" title={recipients.map(formatAddr).join(', ')}>
            받는사람 {recipients.length ? recipients.map((a) => (a.email === me?.email ? '나' : displayName(a))).join(', ') : '나'}
          </div>
        </div>
        <span className="tnum shrink-0 pt-0.5 text-[11.5px] text-ink-3" title={longDate(m.date)}>
          {relative(m.date)}
        </span>
        <div className="-mr-1 -mt-0.5 flex shrink-0 items-center">
          <IconButton
            icon={m.starred ? 'starFilled' : 'star'}
            title="별표 (S)"
            size="sm"
            iconClassName={m.starred ? 'text-star' : ''}
            onClick={() => void act({ type: 'star', value: !m.starred }, [m.id], { quiet: true })}
          />
          <IconButton icon="reply" title="답장 (R)" size="sm" onClick={() => reply(m, 'reply')} />
        </div>
      </header>

      <div className="selectable mt-4 pl-[46px]">
        {(prepared?.hasRemote && !allowRemote) || (dark && prepared && (prepared.mode === 'adapted' || original)) ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
            {prepared?.hasRemote && !allowRemote && (
              <span className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface pl-2.5 pr-1 text-ink-2">
                <Icon name="image" size={14} className="text-ink-3" />
                외부 이미지가 차단되었습니다
                <button
                  className="ml-1 flex h-6 items-center gap-1 rounded-md bg-accent-soft px-2 text-[12px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                  onClick={() => setAllowRemote(true)}
                  title="이 메일의 외부 이미지를 불러옵니다. 발신자가 열람 여부를 알 수 있습니다."
                >
                  이미지 표시
                </button>
              </span>
            )}
            {dark && prepared && (prepared.mode === 'adapted' || original) && (
              <button className="ml-auto flex items-center gap-1 hover:text-ink-2" onClick={() => setOriginal(!original)} title="메일 원래 색상으로 보기">
                <Icon name="image" size={12} />
                {original ? '다크 모드로 보기' : '원본 색상'}
              </button>
            )}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">본문을 불러오지 못했습니다: {error}</div>
        ) : !body ? (
          <div className="space-y-2.5 py-1">
            <div className="skeleton h-2.5 w-3/4 rounded" />
            <div className="skeleton h-2.5 w-2/3 rounded" />
            <div className="skeleton h-2.5 w-1/2 rounded" />
          </div>
        ) : prepared ? (
          <div data-mail-body className={cx('animate-fade', paper && 'overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_var(--line)]', paper && dark && 'brightness-[.94]')}>
            <HtmlFrame doc={prepared.doc} />
          </div>
        ) : (
          <div
            data-mail-body
            className="animate-fade whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-ink [&_a]:text-accent"
            onClick={(e) => {
              const a = (e.target as Element).closest('a')
              if (a) {
                e.preventDefault()
                void api.app.openExternal(a.getAttribute('href') ?? '')
              }
            }}
            dangerouslySetInnerHTML={{ __html: linkify(body.text ?? '') }}
          />
        )}
        <Attachments messageId={m.id} list={body?.attachments ?? m.attachments} />
      </div>
    </article>
  )
}

export function ThreadView({ id }: { id: number }): React.JSX.Element {
  const [messages, setMessages] = useState<MessageMeta[] | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const split = useLayout((s) => s.split)
  const mailboxes = useStore((s) => s.mailboxes)
  const accounts = useStore((s) => s.accounts)
  const view = useStore((s) => s.view)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    async (initial: boolean) => {
      const list = await api.messages.thread(id)
      setMessages(list)
      if (initial) {
        // expand the latest + unread messages
        const ex = new Set<number>()
        list.forEach((m, i) => {
          if (i === list.length - 1 || m.unread) ex.add(m.id)
        })
        setExpanded(ex)
        void api.messages.prefetch(list.map((m) => m.id))
      }
    },
    [id]
  )

  useLayoutEffect(() => {
    setMessages(null)
    void load(true)
    scrollRef.current?.scrollTo(0, 0)
  }, [load])

  useEffect(() => {
    const l = (): void => void load(false)
    threadListeners.add(l)
    return () => {
      threadListeners.delete(l)
    }
  }, [load])

  const last = messages?.[messages.length - 1]
  const labels = useMemo(() => {
    const ids = new Set(messages?.flatMap((m) => m.labelIds) ?? [])
    return mailboxes.filter((mb) => ids.has(mb.id) && mb.type === 'user')
  }, [messages, mailboxes])
  const account = accounts.find((a) => a.id === last?.accountId)
  const inTrash = view.kind === 'role' && view.role === 'trash'

  // expose the latest message for r/a/f shortcuts
  useEffect(() => {
    currentThreadLast = last ?? null
    return () => {
      currentThreadLast = null
    }
  }, [last])

  if (!messages) return <div className="h-full" />
  if (!messages.length) return <div className="flex h-full items-center justify-center text-[13px] text-ink-3">메시지를 찾을 수 없습니다</div>

  return (
    <div data-region="thread" className="flex h-full min-w-0 flex-col">
      <div className="drag flex h-[52px] shrink-0 items-center gap-0.5 px-3">
        {!split && <IconButton icon="back" title="목록으로 (U)" onClick={() => openThread(null)} />}
        {inTrash ? (
          <IconButton icon="restore" title="복원" onClick={() => void act({ type: 'untrash' }, [id])} />
        ) : (
          <>
            <IconButton icon="archive" title="보관 (E)" onClick={() => void act({ type: 'archive' }, [id])} />
            <IconButton icon="trash" title="삭제 (#)" danger onClick={() => void act({ type: 'trash' }, [id])} />
          </>
        )}
        <IconButton
          icon="markUnread"
          title="읽지 않음으로 표시 (⇧U)"
          onClick={() => {
            void act({ type: 'read', value: false }, [id], { quiet: true })
            openThread(null)
          }}
        />
        <div className="flex-1" />
        {account && accounts.length > 1 && (
          <span className="mr-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-ink-3" title={account.email}>
            <AccountMark id={account.id} email={account.email} color={account.color} size={14} />
            {account.email}
          </span>
        )}
        {split && <IconButton icon="close" title="닫기 (Esc)" onClick={() => openThread(null)} />}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div key={id} className="animate-slide-right mx-auto max-w-[860px] px-6 pb-10">
          <h1 className="selectable pb-2 pt-3 text-[21px] font-semibold leading-[1.35] tracking-[-0.02em] text-ink">
            {last?.subject || '(제목 없음)'}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5 pb-3">
            {messages.length > 1 && <span className="tnum mr-1 text-[12px] text-ink-3">메시지 {messages.length}개</span>}
            {labels.map((l) => (
              <LabelChip key={l.id} name={l.name} color={l.colorBg} />
            ))}
          </div>
          <div className="-mx-3">
            {messages.map((m, i) => (
              <MessageCard
                key={m.id}
                m={m}
                isLast={i === messages.length - 1}
                expanded={expanded.has(m.id)}
                onToggle={() => {
                  const ex = new Set(expanded)
                  if (ex.has(m.id)) ex.delete(m.id)
                  else ex.add(m.id)
                  setExpanded(ex)
                }}
              />
            ))}
          </div>
          {last && <QuickReply last={last} />}
        </div>
      </div>
    </div>
  )
}

export let currentThreadLast: MessageMeta | null = null

function QuickReply({ last }: { last: MessageMeta }): React.JSX.Element {
  const many = last.to.length + last.cc.length > 1
  const action = (label: string, k: string, mode: 'reply' | 'replyAll' | 'forward', icon: 'reply' | 'replyAll' | 'forward'): React.JSX.Element => (
    <button
      onClick={() => reply(last, mode)}
      className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
    >
      <Icon name={icon} size={14} />
      {label}
      <kbd>{k}</kbd>
    </button>
  )
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-1.5 shadow-[0_1px_2px_rgba(0,0,0,.03)]">
      <button
        onClick={() => reply(last, 'reply')}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink-3 hover:bg-hover"
      >
        <Icon name="reply" size={15} />
        {displayName(last.from)}님에게 답장…
      </button>
      <div className="mt-1 flex items-center gap-0.5 border-t border-line px-1 pt-1.5">
        {action('답장', 'R', 'reply', 'reply')}
        {many && action('전체답장', 'A', 'replyAll', 'replyAll')}
        {action('전달', 'F', 'forward', 'forward')}
      </div>
    </div>
  )
}
