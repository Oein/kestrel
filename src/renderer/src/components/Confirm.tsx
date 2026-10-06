// In-app confirmation dialog (replaces window.confirm). `await confirmDialog({...})` resolves true/false.
import { useEffect } from 'react'
import { create } from 'zustand'
import { usePresence } from '../lib/motion'
import { Icon } from './Icon'
import { btn, cx } from './ui'

interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

const useConfirm = create<{ req: ConfirmRequest | null }>(() => ({ req: null }))

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().req?.resolve(false)
    useConfirm.setState({ req: { ...opts, resolve } })
  })
}

function answer(ok: boolean): void {
  const req = useConfirm.getState().req
  if (!req) return
  useConfirm.setState({ req: null })
  req.resolve(ok)
}

export function ConfirmLayer(): React.JSX.Element | null {
  const live = useConfirm((s) => s.req)
  const { mounted, closing } = usePresence(!!live, 120)
  // keep showing the last request while the exit animation plays
  const last = useConfirmLast(live)

  useEffect(() => {
    if (!live) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') answer(false)
      else if (e.key === 'Enter') answer(true)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [live])

  if (!mounted || !last) return null
  return (
    <div
      className={cx('fixed inset-0 z-[90] flex items-center justify-center bg-black/25 p-6 dark:bg-black/45', closing ? 'animate-fade-out pointer-events-none' : 'animate-fade')}
      onMouseDown={() => answer(false)}
    >
      <div
        role="alertdialog"
        className={cx(
          'w-full max-w-[380px] rounded-2xl border border-line bg-raised p-5 shadow-float',
          closing ? 'animate-pop-out' : 'animate-rise'
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <span
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              last.danger ? 'bg-danger/12 text-danger' : 'bg-accent-soft text-accent'
            )}
          >
            <Icon name={last.danger ? 'trash' : 'warning'} size={17} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[14px] font-semibold text-ink">{last.title}</h2>
            {last.message && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{last.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className={btn.secondary} onClick={() => answer(false)}>
            {last.cancelLabel ?? '취소'}
            <kbd className="ml-0.5">esc</kbd>
          </button>
          <button
            autoFocus
            className={cx(btn.primary, last.danger && '!bg-danger hover:!bg-danger/90 !text-white')}
            onClick={() => answer(true)}
          >
            {last.confirmLabel ?? '확인'}
            <kbd className="ml-0.5 !border-white/25 !bg-white/15 !text-current">↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

let lastReq: ConfirmRequest | null = null
function useConfirmLast(live: ConfirmRequest | null): ConfirmRequest | null {
  if (live) lastReq = live
  return live ?? lastReq
}
