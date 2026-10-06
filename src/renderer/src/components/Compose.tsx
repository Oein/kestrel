import { useEffect, useRef, useState } from 'react'
import type { Draft } from '../../../shared/types'
import { fileSize } from '../lib/format'
import { prepareHtml } from '../lib/sanitize'
import { api, closeCompose, sendCompose, toast, useStore, type ComposeState } from '../store'
import { Icon } from './Icon'

function ComposeWindow({ c, index, total }: { c: ComposeState; index: number; total: number }): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const [d, setD] = useState<Draft>(c.draft)
  const [minimized, setMinimized] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [showCc, setShowCc] = useState(!!(c.draft.cc || c.draft.bcc))
  const [showQuote, setShowQuote] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
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

  const discard = (): void => {
    if ((d.body.trim() || d.subject.trim()) && !confirm('작성 중인 메일을 삭제할까요?')) return
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

  const right = 16 + (total - 1 - index) * 528
  const input = 'w-full bg-transparent py-2 outline-none placeholder:opacity-50'
  const field = 'flex items-center gap-2 border-b border-black/10 px-4 text-[14px] dark:border-white/10'

  if (minimized) {
    return (
      <div
        className="fixed bottom-0 z-40 flex h-10 w-[280px] cursor-default items-center gap-2 rounded-t-lg bg-[#f2f6fc] px-4 shadow-lg dark:bg-[#2a2e36]"
        style={{ right }}
        onClick={() => setMinimized(false)}
      >
        <span className="flex-1 truncate text-[13px] font-medium">{d.subject || c.title}</span>
        <button onClick={(e) => (e.stopPropagation(), discard())} className="opacity-60 hover:opacity-100">
          <Icon name="close" size={16} />
        </button>
      </div>
    )
  }

  const box = maximized
    ? 'fixed inset-x-[8%] inset-y-[6%] z-50'
    : 'fixed bottom-0 z-40 h-[560px] max-h-[calc(100vh-60px)] w-[512px]'

  return (
    <>
      {maximized && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMaximized(false)} />}
      <div
        className={`${box} flex flex-col overflow-hidden rounded-t-xl bg-white shadow-[0_8px_30px_rgba(0,0,0,.25)] dark:bg-[#1b1e24] ${maximized ? 'rounded-xl' : ''}`}
        style={maximized ? undefined : { right }}
        onKeyDown={onKeyDown}
      >
        <div className="flex h-10 shrink-0 items-center gap-1 bg-[#f2f6fc] pl-4 pr-2 dark:bg-[#2a2e36]">
          <span className="flex-1 truncate text-[13px] font-medium">{d.subject || c.title}</span>
          <button title="최소화" onClick={() => setMinimized(true)} className="rounded p-1 opacity-60 hover:bg-black/10 hover:opacity-100">
            <Icon name="minimize" size={16} />
          </button>
          <button title="전체화면" onClick={() => setMaximized(!maximized)} className="rounded p-1 opacity-60 hover:bg-black/10 hover:opacity-100">
            <Icon name="expand" size={16} />
          </button>
          <button title="닫기" onClick={discard} className="rounded p-1 opacity-60 hover:bg-black/10 hover:opacity-100">
            <Icon name="close" size={16} />
          </button>
        </div>
        {accounts.length > 1 && (
          <div className={field}>
            <span className="w-16 shrink-0 text-[13px] opacity-60">보낸사람</span>
            <select value={d.accountId} onChange={(e) => upd({ accountId: e.target.value })} className={`${input} cursor-default`}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} <${a.email}>` : a.email}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={field}>
          <span className="w-16 shrink-0 text-[13px] opacity-60">받는사람</span>
          <input ref={toRef} value={d.to} onChange={(e) => upd({ to: e.target.value })} className={input} />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="shrink-0 text-[13px] opacity-60 hover:underline">
              참조/숨은참조
            </button>
          )}
        </div>
        {showCc && (
          <>
            <div className={field}>
              <span className="w-16 shrink-0 text-[13px] opacity-60">참조</span>
              <input value={d.cc} onChange={(e) => upd({ cc: e.target.value })} className={input} />
            </div>
            <div className={field}>
              <span className="w-16 shrink-0 text-[13px] opacity-60">숨은참조</span>
              <input value={d.bcc} onChange={(e) => upd({ bcc: e.target.value })} className={input} />
            </div>
          </>
        )}
        <div className={field}>
          <input value={d.subject} onChange={(e) => upd({ subject: e.target.value })} placeholder="제목" className={input} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <textarea
            ref={bodyRef}
            value={d.body}
            onChange={(e) => upd({ body: e.target.value })}
            className="min-h-[160px] flex-1 resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none"
          />
          {d.quotedHtml && (
            <div className="px-4 pb-3">
              <button
                onClick={() => setShowQuote(!showQuote)}
                className="rounded bg-black/5 px-2 text-[13px] leading-5 opacity-70 hover:opacity-100 dark:bg-white/10"
                title="인용된 내용 표시"
              >
                •••
              </button>
              {showQuote && (
                <iframe
                  title="인용"
                  sandbox=""
                  srcDoc={prepareHtml(d.quotedHtml, false).doc}
                  className="mt-2 h-60 w-full rounded border border-black/10 bg-white"
                />
              )}
            </div>
          )}
          {d.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {d.attachments.map((a, i) => (
                <span key={a.path} className="flex items-center gap-2 rounded bg-black/5 px-2 py-1 text-[12px] dark:bg-white/10">
                  <span className="max-w-[200px] truncate font-medium text-[#0b57d0] dark:text-[#a8c7fa]">{a.filename}</span>
                  <span className="opacity-60">({fileSize(a.size)})</span>
                  <button onClick={() => upd({ attachments: d.attachments.filter((_, j) => j !== i) })} className="opacity-60 hover:opacity-100">
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <button
            onClick={send}
            className="rounded-full bg-[#0b57d0] px-6 py-2 text-[14px] font-medium text-white hover:bg-[#0a4ebb] hover:shadow"
            title="보내기 (⌘Enter)"
          >
            보내기
          </button>
          <button
            title="파일 첨부"
            onClick={async () => {
              const files = await api.compose.pickFiles()
              if (files.length) upd({ attachments: [...d.attachments, ...files] })
            }}
            className="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <Icon name="attach" />
          </button>
          <span className="flex-1 text-right text-[11px] opacity-40">⌘Enter 보내기 · 5초 내 실행취소 가능</span>
          <button title="삭제" onClick={discard} className="rounded-full p-2 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
            <Icon name="trash" />
          </button>
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
