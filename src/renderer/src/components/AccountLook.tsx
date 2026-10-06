// Account icon editor: letters/emoji, colour, or a picture. Opened by right-clicking an account in the rail.
import { useRef, useState } from 'react'
import { create } from 'zustand'
import { ACCOUNT_ICONS } from '../lib/accountIcons'
import { setAccountLook, usePrefs, type AccountLook } from '../lib/prefs'
import { useStore } from '../store'
import { Modal } from './Dialogs'
import { Icon } from './Icon'
import { btn, cx, inputCls } from './ui'

export const useLookEditor = create<{ id: string | null }>(() => ({ id: null }))
export const editAccountLook = (id: string): void => useLookEditor.setState({ id })

const SWATCHES = ['#e4532b', '#e8902a', '#d4a72c', '#4d9a4a', '#2f9e8f', '#3b82f6', '#5b5bd6', '#8e55c9', '#c94f8a', '#6b6660', '#1f1e1b', '#a3824f']

/** Downscale a picked image to a small square data URL so prefs stay tiny. */
function toThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const size = 96
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')!
      const s = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export function AccountLookEditor({ closing }: { closing?: boolean }): React.JSX.Element | null {
  const id = useLookEditor((s) => s.id)
  const account = useStore((s) => s.accounts.find((a) => a.id === id))
  const saved = usePrefs((s) => (id ? s.accountLooks[id] : undefined))
  const [look, setLook] = useState<AccountLook>(saved ?? {})
  const fileRef = useRef<HTMLInputElement>(null)
  const close = (): void => useLookEditor.setState({ id: null })
  if (!account) return null

  const preview = (patch: AccountLook): void => setLook((l) => ({ ...l, ...patch }))
  const save = (): void => {
    const clean: AccountLook = {}
    if (look.text?.trim()) clean.text = [...look.text.trim()].slice(0, 2).join('')
    else if (look.icon) clean.icon = look.icon
    if (look.color) clean.color = look.color
    if (look.image) clean.image = look.image
    setAccountLook(account.id, Object.keys(clean).length ? clean : null)
    close()
  }

  const draftColor = look.color ?? account.color
  const PreviewIcon = look.icon ? ACCOUNT_ICONS[look.icon] : undefined
  return (
    <Modal title="계정 아이콘" subtitle={account.email} onClose={close} width={400} closing={closing}>
      <div className="flex items-center gap-4">
        <span className="relative">
          <span
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] text-[26px] font-bold text-white shadow-pop"
            style={{ background: look.image ? 'transparent' : draftColor }}
          >
            {look.image ? (
              <img src={look.image} alt="" className="h-full w-full object-cover" />
            ) : look.text?.trim() ? (
              look.text.trim()
            ) : PreviewIcon ? (
              <PreviewIcon size={32} strokeWidth={2} />
            ) : (
              account.email[0].toUpperCase()
            )}
          </span>
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            autoFocus
            value={look.text ?? ''}
            onChange={(e) => preview({ text: e.target.value, image: undefined, icon: undefined })}
            placeholder={`글자 1–2자 (기본: ${account.email[0].toUpperCase()})`}
            className={inputCls}
            maxLength={8}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <div className="flex gap-1.5">
            <button className={cx(btn.secondary, 'h-7 px-2.5 text-[12px]')} onClick={() => fileRef.current?.click()}>
              <Icon name="image" size={13} />
              이미지
            </button>
            {(look.image || look.text || look.color || look.icon) && (
              <button className={cx(btn.ghost, 'h-7 px-2.5 text-[12px]')} onClick={() => setLook({})}>
                기본값
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) preview({ image: await toThumb(f) })
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="mt-5 text-[12px] font-medium text-ink-2">색상</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => preview({ color: c, image: undefined })}
            className={cx('h-7 w-7 rounded-lg', draftColor === c && !look.image && 'shadow-[0_0_0_2px_var(--raised),0_0_0_4px_var(--ink)]')}
            style={{ background: c }}
            title={c}
          />
        ))}
        <label className="relative flex h-7 w-7 cursor-default items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-3 hover:text-ink" title="직접 선택">
          <Icon name="plus" size={13} />
          <input type="color" value={draftColor} onChange={(e) => preview({ color: e.target.value, image: undefined })} className="absolute inset-0 opacity-0" />
        </label>
      </div>

      <div className="mt-5 text-[12px] font-medium text-ink-2">아이콘</div>
      <div className="mt-2 grid grid-cols-10 gap-1">
        {Object.entries(ACCOUNT_ICONS).map(([key, Glyph]) => (
          <button
            key={key}
            onClick={() => preview({ icon: look.icon === key ? undefined : key, text: undefined, image: undefined })}
            className={cx(
              'flex aspect-square items-center justify-center rounded-lg transition-colors',
              look.icon === key ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-hover hover:text-ink'
            )}
          >
            <Glyph size={17} strokeWidth={1.9} />
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-[11.5px] text-ink-3">왼쪽 계정 아이콘을 우클릭해도 열립니다</span>
        <div className="flex gap-2">
          <button className={btn.ghost} onClick={close}>
            취소
          </button>
          <button className={btn.primary} onClick={save}>
            저장
          </button>
        </div>
      </div>
    </Modal>
  )
}
