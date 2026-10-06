import { useEffect, useMemo, useRef, useState } from 'react'
import type { Draft } from '../../../shared/types'
import { fileSize } from '../lib/format'
import { prepareHtml } from '../lib/sanitize'
import { api, closeCompose, sendCompose, toast, useStore, type ComposeState } from '../store'
import { Icon } from './Icon'
import { confirmDialog } from './Confirm'
import { AccountMark, btn, cx, IconButton } from './ui'

function ComposeWindow({ c, index, total }: { c: ComposeState; index: number; total: number }): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const [d, setD] = useState<Draft>(c.draft)
  const [minimized, setMinimized] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [showCc, setShowCc] = useState(!!(c.draft.cc || c.draft.bcc))
  const [showQuote, setShowQuote] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const quoteDoc = useMemo(() => (d.quotedHtml ? prepareHtml(d.quotedHtml, false, dark).doc : ''), [d.quotedHtml, dark])
  const toRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (c.draft.to) bodyRef.current?.focus()
    else toRef.current?.focus()
  }, [c.draft.to])

  const upd = (patch: Partial<Draft>): void => setD((prev) => ({ ...prev, ...patch }))

  const send = (): void => {
    if (!d.to.trim() && !d.cc.trim() && !d.bcc.trim()) {
      toast('error', '받는사람을 한 명 이상 입력하세요.')
      return
    }
    if (!d.accountId) {
      toast('error', '보낼 계정을 선택하세요.')
      return
    }
    sendCompose(c.key, d)
  }

  const discard = async (): Promise<void> => {
    if (
      (d.body.trim() || d.subject.trim()) &&
      !(await confirmDialog({ title: '작성 중인 메일을 삭제할까요?', message: '삭제한 내용은 되돌릴 수 없습니다.', confirmLabel: '삭제', danger: true }))
    )
      return
    closeCompose(c.key)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation() // keep global shortcuts out of the editor
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMinimized(true)
    }
  }

  const right = 20 + (total - 1 - index) * 536
  const account = accounts.find((a) => a.id === d.accountId)
  const input = 'h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none'
  const row = 'flex items-center gap-3 border-b border-line px-4'
  const label = 'w-14 shrink-0 text-[12.5px] text-ink-3'

  if (minimized) {
    return (
      <div
        className="animate-pop fixed bottom-4 z-40 flex h-10 w-[260px] items-center gap-2 rounded-xl border border-line bg-raised pl-3.5 pr-1.5 shadow-float"
        style={{ right }}
        onClick={() => setMinimized(false)}
      >
        <Icon name="pencil" size={13} className="text-accent" />
        <span className="flex-1 truncate text-[12.5px] font-medium">{d.subject || c.title}</span>
        <IconButton icon="close" title="삭제" size="sm" onClick={discard} />
      </div>
    )
  }

  return (
    <>
      {maximized && <div className="animate-fade fixed inset-0 z-40 bg-black/25" onClick={() => setMaximized(false)} />}
      <div
        className={cx(
          'animate-rise flex flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-float',
          maximized ? 'fixed inset-x-[10%] inset-y-[7%] z-50' : 'fixed bottom-4 z-40 h-[580px] max-h-[calc(100vh-40px)] w-[520px]'
        )}
        style={maximized ? undefined : { right }}
        onKeyDown={onKeyDown}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 pl-4 pr-2">
          <span className="flex-1 truncate text-[13px] font-semibold">{d.subject || c.title}</span>
          <IconButton icon="minimize" title="최소화 (Esc)" size="sm" onClick={() => setMinimized(true)} />
          <IconButton icon={maximized ? 'shrink' : 'expand'} title={maximized ? '작게' : '크게'} size="sm" onClick={() => setMaximized(!maximized)} />
          <IconButton icon="close" title="삭제" size="sm" onClick={discard} />
        </div>
        <div className="border-t border-line" />
        {accounts.length > 1 && (
          <div className={row}>
            <span className={label}>보낸사람</span>
            {account && <AccountMark id={account.id} email={account.email} color={account.color} size={16} />}
            <select value={d.accountId} onChange={(e) => upd({ accountId: e.target.value })} className={cx(input, '-ml-1 appearance-none')}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} <${a.email}>` : a.email}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={13} className="pointer-events-none text-ink-3" />
          </div>
        )}
        <div className={row}>
          <span className={label}>받는사람</span>
          <input ref={toRef} value={d.to} onChange={(e) => upd({ to: e.target.value })} className={input} />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="shrink-0 text-[12px] text-ink-3 hover:text-ink">
              참조 · 숨은참조
            </button>
          )}
        </div>
        {showCc && (
          <>
            <div className={row}>
              <span className={label}>참조</span>
              <input value={d.cc} onChange={(e) => upd({ cc: e.target.value })} className={input} />
            </div>
            <div className={row}>
              <span className={label}>숨은참조</span>
              <input value={d.bcc} onChange={(e) => upd({ bcc: e.target.value })} className={input} />
            </div>
          </>
        )}
        <div className={row}>
          <input value={d.subject} onChange={(e) => upd({ subject: e.target.value })} placeholder="제목" className={cx(input, 'font-semibold')} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <textarea
            ref={bodyRef}
            value={d.body}
            onChange={(e) => upd({ body: e.target.value })}
            placeholder="내용을 입력하세요"
            className="min-h-[160px] flex-1 resize-none bg-transparent px-4 py-3 text-[14px] leading-[1.7] text-ink outline-none"
          />
          {d.quotedHtml && (
            <div className="animate-fade mx-4 mb-3 overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex h-8 items-center gap-2 border-b border-line pl-3 pr-1 text-[12px] text-ink-2">
                <Icon name={c.title === '전달' ? 'forward' : 'reply'} size={13} className="text-ink-3" />
                <span className="flex-1 font-medium">{c.title === '전달' ? '전달할 메일이 포함됩니다' : '이전 메일이 함께 인용됩니다'}</span>
                <IconButton
                  icon={showQuote ? 'shrink' : 'expand'}
                  title={showQuote ? '접기' : '펼쳐 보기'}
                  size="sm"
                  onClick={() => setShowQuote(!showQuote)}
                />
                <IconButton icon="close" title="인용 빼고 보내기" size="sm" danger onClick={() => upd({ quotedHtml: null })} />
              </div>
              <div className="relative">
                <iframe
                  title="인용된 메일"
                  sandbox=""
                  srcDoc={quoteDoc}
                  className={cx('block w-full border-0 bg-transparent transition-[height] duration-200', showQuote ? 'h-72' : 'h-24')}
                />
                {!showQuote && (
                  <button
                    onClick={() => setShowQuote(true)}
                    className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-surface to-transparent pb-1.5 text-[11.5px] font-medium text-ink-3 hover:text-ink"
                  >
                    더 보기
                  </button>
                )}
              </div>
            </div>
          )}
          {d.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {d.attachments.map((a, i) => (
                <span key={a.path} className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface pl-2 pr-1 text-[12px]">
                  <Icon name="attach" size={12} className="text-ink-3" />
                  <span className="max-w-[180px] truncate font-medium">{a.filename}</span>
                  <span className="tnum text-ink-3">{fileSize(a.size)}</span>
                  <button
                    onClick={() => upd({ attachments: d.attachments.filter((_, j) => j !== i) })}
                    className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center gap-1 border-t border-line px-3">
          <button onClick={send} className={cx(btn.primary, 'gap-2 pl-3.5 pr-3')} title="보내기 (⌘↵)">
            <Icon name="send" size={13} stroke={2} />
            보내기
            <span className="text-[11px] font-medium opacity-60">⌘↵</span>
          </button>
          <IconButton
            icon="attach"
            title="파일 첨부"
            className="ml-1"
            onClick={async () => {
              const files = await api.compose.pickFiles()
              if (files.length) upd({ attachments: [...d.attachments, ...files] })
            }}
          />
          <span className="flex-1 text-right text-[11px] text-ink-3">보낸 후 5초 동안 취소할 수 있습니다</span>
          <IconButton icon="trash" title="삭제" danger onClick={discard} />
        </div>
      </div>
    </>
  )
}

export function ComposeLayer(): React.JSX.Element {
  const composes = useStore((s) => s.composes)
  return (
    <>
      {composes.map((c, i) => (
        <ComposeWindow key={c.key} c={c} index={i} total={composes.length} />
      ))}
    </>
  )
}
