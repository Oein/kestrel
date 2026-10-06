// App-wide tooltips. Any element with a `title` (or `data-tip`) gets a fast, styled tooltip instead of the
// slow native one. A trailing "(E)" / "(⌘K)" in the text is rendered as a shortcut chip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Tip {
  text: string
  keys: string | null
  anchor: DOMRect
}

const GAP = 6
const MARGIN = 8

const SHOW_DELAY = 380
const WARM_WINDOW = 600 // after one tooltip closes, the next shows instantly

function parse(raw: string): { text: string; keys: string | null } {
  const m = /^(.*?)\s*\(([^()]{1,14})\)\s*$/.exec(raw)
  if (m && /^[⌘⇧⌥⌃#/?A-Za-z0-9↵⌫ ,+.-]+$/.test(m[2]) && !/\s{2,}/.test(m[2])) return { text: m[1], keys: m[2] }
  return { text: raw, keys: null }
}

export function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    let lastHide = 0

    const hide = (): void => {
      window.clearTimeout(timer)
      if (current) lastHide = Date.now()
      current = null
      setTip(null)
    }

    const show = (el: HTMLElement): void => {
      const raw = el.dataset.tip
      if (!raw || !el.isConnected) return
      setTip({ ...parse(raw), anchor: el.getBoundingClientRect() })
    }

    const over = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[title], [data-tip]')
      if (el === current) return
      if (!el) return hide()
      // adopt native titles so the browser tooltip never shows
      const t = el.getAttribute('title')
      if (t) {
        el.dataset.tip = t
        el.removeAttribute('title')
      }
      window.clearTimeout(timer)
      setTip(null)
      current = el
      const warm = Date.now() - lastHide < WARM_WINDOW
      timer = window.setTimeout(() => current === el && show(el), warm ? 0 : SHOW_DELAY)
    }

    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  return tip ? <TipBox key={`${tip.anchor.left},${tip.anchor.top},${tip.text}`} tip={tip} /> : null
}

/** Measures itself, then sits above the anchor (below if no room; to the right for the far-left rail). */
function TipBox({ tip }: { tip: Tip }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const a = tip.anchor
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (a.right < 72) {
      // account rail: to the right, vertically centred
      left = a.right + GAP + 2
      top = a.top + a.height / 2 - box.height / 2
    } else {
      left = a.left + a.width / 2 - box.width / 2
      top = a.top - GAP - box.height
      if (top < MARGIN) top = a.bottom + GAP
    }
    left = Math.min(Math.max(left, MARGIN), vw - box.width - MARGIN)
    top = Math.min(Math.max(top, MARGIN), vh - box.height - MARGIN)
    setPos({ left, top })
  }, [tip])
  return (
    <div
      ref={ref}
      className={`pointer-events-none fixed left-0 top-0 z-[80] flex max-w-[280px] items-center gap-1.5 rounded-md bg-[#1f1e1b] px-2 py-1 text-[11.5px] font-medium text-[#f1efea] shadow-pop dark:bg-[#f1efea] dark:text-[#1f1e1b] ${pos ? 'animate-fade' : 'invisible'}`}
      style={pos ? { transform: `translate(${pos.left}px, ${pos.top}px)` } : undefined}
    >
      <span className="truncate">{tip.text}</span>
      {tip.keys && (
        <span className="flex gap-0.5">
          {tip.keys.split(/\s+/).map((k, i) => (
            <span key={i} className="rounded-[4px] border border-current/25 px-1 text-[10px] leading-[14px] opacity-70">
              {k}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
