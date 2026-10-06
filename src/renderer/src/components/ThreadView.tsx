import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AttachmentInfo, MessageBody, MessageMeta } from '../../../shared/types'
import { avatarColor, displayName, fileSize, formatAddr, initials, longDate, relative } from '../lib/format'
import { linkify, prepareHtml } from '../lib/sanitize'
import { act, api, cachedBody, fetchBody, onBodies, openThread, reply, threadListeners, toast, useStore } from '../store'
import { Icon } from './Icon'

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
function HtmlFrame({ html, allowRemote }: { html: string; allowRemote: boolean }): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)
  const { doc } = useMemo(() => prepareHtml(html, allowRemote), [html, allowRemote])

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
    // forward keyboard shortcuts to the app while the frame has focus
    d.addEventListener('keydown', (e) => {
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
      className="w-full rounded-md border-0 bg-white"
    />
  )
}

function Attachments({ messageId, list }: { messageId: number; list: AttachmentInfo[] }): React.JSX.Element | null {
  const visible = list.filter((a) => !a.inline)
  if (!visible.length) return null
  return (
    <div className="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
      <div className="mb-2 text-xs font-medium opacity-60">첨부파일 {visible.length}개</div>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => (
          <div
            key={a.id}
            className="group flex w-[220px] items-center gap-2 rounded-lg border border-black/10 px-3 py-2 dark:border-white/10"
          >
            <Icon name={a.mimeType.startsWith('image/') ? 'image' : 'attach'} size={18} className="opacity-60" />
            <button
              className="min-w-0 flex-1 text-left"
              title="열기"
              onClick={() => api.attachments.open(messageId, a.id).catch((e: Error) => toast('error', e.message))}
            >
              <div className="truncate text-[13px]">{a.filename}</div>
              <div className="text-[11px] opacity-50">{fileSize(a.size)}</div>
            </button>
            <button
              title="다운로드"
              className="rounded-full p-1 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
              onClick={() => api.attachments.save(messageId, a.id).catch((e: Error) => toast('error', e.message))}
            >
              <Icon name="download" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageCard({ m, expanded, onToggle, isLast }: { m: MessageMeta; expanded: boolean; onToggle: () => void; isLast: boolean }): React.JSX.Element {
  const { body, error } = useBody(m.id, expanded)
  const [allowRemote, setAllowRemote] = useState(false)
  const accounts = useStore((s) => s.accounts)
  const me = accounts.find((a) => a.id === m.accountId)
  const hasRemote = useMemo(() => (body?.html ? prepareHtml(body.html, false).hasRemote : false), [body?.html])

  if (!expanded) {
    return (
      <button onClick={onToggle} className="flex w-full items-center gap-3 border-b border-black/5 px-5 py-3 text-left hover:bg-black/[.02] dark:border-white/5 dark:hover:bg-white/[.03]">
        <Avatar m={m} />
        <span className={`w-40 shrink-0 truncate ${m.unread ? 'font-bold' : 'font-medium'}`}>{displayName(m.from)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] opacity-60">{m.snippet}</span>
        <span className="shrink-0 text-xs opacity-60">{relative(m.date)}</span>
      </button>
    )
  }

  const recipients = [...m.to, ...m.cc]
  return (
    <div className={`px-5 py-4 ${isLast ? '' : 'border-b border-black/5 dark:border-white/5'}`}>
      <div className="flex items-start gap-3">
        <Avatar m={m} />
        <div className="min-w-0 flex-1 cursor-default" onClick={isLast ? undefined : onToggle}>
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{displayName(m.from)}</span>
            {m.from.name && <span className="truncate text-xs opacity-60">&lt;{m.from.email}&gt;</span>}
          </div>
          <div className="truncate text-xs opacity-60" title={recipients.map(formatAddr).join(', ')}>
            받는사람: {recipients.length ? recipients.map((a) => (a.email === me?.email ? '나' : displayName(a))).join(', ') : '(없음)'}
          </div>
        </div>
        <span className="shrink-0 pt-0.5 text-xs opacity-60" title={longDate(m.date)}>
          {longDate(m.date)}
        </span>
        <div className="flex shrink-0 items-center">
          <IconBtn icon={m.starred ? 'starFilled' : 'star'} title="별표" className={m.starred ? 'text-amber-400 opacity-100' : ''} onClick={() => act({ type: 'star', value: !m.starred }, [m.id], { quiet: true })} />
          <IconBtn icon="reply" title="답장 (r)" onClick={() => reply(m, 'reply')} />
        </div>
      </div>

      <div className="selectable mt-3 pl-[52px]">
        {hasRemote && !allowRemote && (
          <div className="mb-3 flex items-center gap-3 rounded-md bg-black/[.04] px-3 py-2 text-[13px] dark:bg-white/[.06]">
            <Icon name="image" size={16} className="opacity-60" />
            <span className="flex-1 opacity-80">개인정보 보호를 위해 외부 이미지가 차단되었습니다.</span>
            <button className="font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]" onClick={() => setAllowRemote(true)}>
              이미지 표시
            </button>
          </div>
        )}
        {error ? (
          <div className="text-[13px] text-red-500">본문을 불러오지 못했습니다: {error}</div>
        ) : !body ? (
          <div className="space-y-2 py-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-black/10 dark:bg-white/10" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-black/10 dark:bg-white/10" />
            <div className="text-[13px] opacity-60">{m.snippet}</div>
          </div>
        ) : body.html ? (
          <HtmlFrame html={body.html} allowRemote={allowRemote} />
        ) : (
          <div
            className="whitespace-pre-wrap break-words text-[14px] leading-relaxed [&_a]:text-[#0b57d0] dark:[&_a]:text-[#a8c7fa]"
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
    </div>
  )
}

function Avatar({ m }: { m: MessageMeta }): React.JSX.Element {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-medium text-white"
      style={{ background: avatarColor(m.from.email) }}
    >
      {initials(m.from)}
    </span>
  )
}

function IconBtn(props: { icon: Parameters<typeof Icon>[0]['name']; title: string; onClick: () => void; className?: string }): React.JSX.Element {
  return (
    <button
      title={props.title}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className={`rounded-full p-2 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10 ${props.className ?? ''}`}
    >
      <Icon name={props.icon} size={19} />
    </button>
  )
}

export function ThreadView({ id }: { id: number }): React.JSX.Element {
  const [messages, setMessages] = useState<MessageMeta[] | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const readingPane = useStore((s) => s.readingPane)
  const mailboxes = useStore((s) => s.mailboxes)
  const accounts = useStore((s) => s.accounts)
  const view = useStore((s) => s.view)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    async (initial: boolean) => {
      const list = await api.messages.thread(id)
      setMessages(list)
      if (initial) {
        // expand the latest + unread messages (Gmail-like)
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

  if (!messages) {
    return <div className="h-full" />
  }
  if (!messages.length) {
    return <div className="flex h-full items-center justify-center opacity-50">메시지를 찾을 수 없습니다.</div>
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        {!readingPane && <IconBtn icon="back" title="목록으로 (u)" onClick={() => openThread(null)} />}
        {inTrash ? (
          <IconBtn icon="restore" title="휴지통에서 복원" onClick={() => act({ type: 'untrash' }, [id])} />
        ) : (
          <>
            <IconBtn icon="archive" title="보관 (e)" onClick={() => act({ type: 'archive' }, [id])} />
            <IconBtn icon="trash" title="삭제 (#)" onClick={() => act({ type: 'trash' }, [id])} />
          </>
        )}
        <IconBtn icon="markUnread" title="읽지 않음으로 표시 (Shift+U)" onClick={() => {
          void act({ type: 'read', value: false }, [id], { quiet: true })
          openThread(null)
        }} />
        <div className="flex-1" />
        {readingPane && <IconBtn icon="close" title="닫기 (Esc)" onClick={() => openThread(null)} />}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start gap-3 px-5 pb-3 pl-[72px] pt-2">
          <h1 className="selectable min-w-0 flex-1 text-[22px] font-normal leading-snug">{last?.subject || '(제목 없음)'}</h1>
          {account && (
            <span className="mt-2 flex shrink-0 items-center gap-1.5 text-xs opacity-60" title={account.email}>
              <span className="h-2 w-2 rounded-full" style={{ background: account.color }} />
              {account.email}
            </span>
          )}
        </div>
        {labels.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1.5 px-5 pb-3 pl-[72px]">
            {labels.map((l) => (
              <span key={l.id} className="rounded px-1.5 py-px text-[11px]" style={{ background: l.colorBg ?? 'rgba(127,127,127,.18)', color: l.colorText ?? undefined }}>
                {l.name}
              </span>
            ))}
          </div>
        )}
        <div className="mx-2 mb-4 rounded-xl bg-white dark:bg-[#1b1e24]">
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
        {last && (
          <div className="flex gap-2 px-5 pb-8 pl-[72px]">
            <ReplyButton icon="reply" label="답장" onClick={() => reply(last, 'reply')} />
            {last.to.length + last.cc.length > 1 && <ReplyButton icon="replyAll" label="전체답장" onClick={() => reply(last, 'replyAll')} />}
            <ReplyButton icon="forward" label="전달" onClick={() => reply(last, 'forward')} />
          </div>
        )}
      </div>
    </div>
  )
}

export let currentThreadLast: MessageMeta | null = null

function ReplyButton({ icon, label, onClick }: { icon: 'reply' | 'replyAll' | 'forward'; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-full border border-black/20 px-5 py-2 text-[13px] font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5">
      <Icon name={icon} size={18} />
      {label}
    </button>
  )
}
