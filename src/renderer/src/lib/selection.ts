// Multi-select for the message list: anchor-based shift-ranges, ⌘-toggle, select-all and drag-select.
import { openThread, toggleSelect, useStore } from '../store'

let anchor: number | null = null // row index the next shift-range starts from

const ids = (from: number, to: number): number[] => {
  const rows = useStore.getState().rows
  const [a, b] = from <= to ? [from, to] : [to, from]
  return rows.slice(a, b + 1).map((r) => r.id)
}

export function setAnchor(index: number): void {
  anchor = index
}

/** Click on a row: plain = open, ⇧ = range from anchor, ⌘ = toggle. */
export function clickRow(index: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): void {
  const s = useStore.getState()
  const row = s.rows[index]
  if (!row) return
  if (e.shiftKey) {
    const from = anchor ?? (s.openId !== null ? s.rows.findIndex((r) => r.id === s.openId) : index)
    const base = e.metaKey || e.ctrlKey ? s.selected : new Set<number>()
    useStore.setState({ selected: new Set([...base, ...ids(Math.max(0, from), index)]), cursor: index })
    return
  }
  anchor = index
  if (e.metaKey || e.ctrlKey) {
    toggleSelect(row.id)
    useStore.setState({ cursor: index })
    return
  }
  openThread(row.id)
}

/** Checkbox: toggle, or extend the range with ⇧. */
export function checkRow(index: number, shift: boolean): void {
  const s = useStore.getState()
  const row = s.rows[index]
  if (!row) return
  if (shift && anchor !== null) {
    const on = !s.selected.has(row.id)
    const next = new Set(s.selected)
    for (const id of ids(anchor, index)) {
      if (on) next.add(id)
      else next.delete(id)
    }
    useStore.setState({ selected: next })
  } else toggleSelect(row.id)
  anchor = index
}

export function selectAll(): void {
  const rows = useStore.getState().rows
  useStore.setState({ selected: new Set(rows.map((r) => r.id)) })
}

// ---------- drag select ----------
let drag: { start: number; base: Set<number>; startY: number; moved: boolean; scroller: HTMLElement; raf: number; y: number } | null = null
let suppressClick = false

/** Returns true (once) when the click that ends a drag-select should be ignored. */
export function consumeDragClick(): boolean {
  const v = suppressClick
  suppressClick = false
  return v
}

function rowIndexAt(y: number, scroller: HTMLElement): number | null {
  const box = scroller.getBoundingClientRect()
  const yy = Math.min(Math.max(y, box.top + 2), box.bottom - 2)
  const el = document.elementFromPoint(box.left + box.width / 2, yy)?.closest<HTMLElement>('[data-row-index]')
  return el ? Number(el.dataset.rowIndex) : null
}

function update(): void {
  if (!drag) return
  const cur = rowIndexAt(drag.y, drag.scroller)
  if (cur !== null) {
    useStore.setState({ selected: new Set([...drag.base, ...ids(drag.start, cur)]), cursor: cur })
    anchor = drag.start
  }
}

function tick(): void {
  if (!drag) return
  // auto-scroll near the edges
  const box = drag.scroller.getBoundingClientRect()
  const edge = 48
  const d = drag.y < box.top + edge ? -(box.top + edge - drag.y) : drag.y > box.bottom - edge ? drag.y - (box.bottom - edge) : 0
  if (d) {
    drag.scroller.scrollTop += Math.max(-24, Math.min(24, d / 2))
    update()
  }
  drag.raf = requestAnimationFrame(tick)
}

/** Drag that begins on empty space (headers, gaps, below the last row): anchor on the nearest row. */
export function startDragFromBlank(e: React.MouseEvent, scroller: HTMLElement | null): void {
  if (e.button !== 0 || !scroller || e.shiftKey) return
  if ((e.target as HTMLElement).closest('[data-row], button, a, input')) return
  // ignore presses on the scrollbar itself
  const box = scroller.getBoundingClientRect()
  if (e.clientX > box.left + scroller.clientWidth) return
  let best: { index: number; d: number } | null = null
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-row-index]')) {
    const r = el.getBoundingClientRect()
    const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
    if (!best || d < best.d) best = { index: Number(el.dataset.rowIndex), d }
  }
  if (!best) return
  e.preventDefault() // no text selection while dragging over blank space
  begin(best.index, e, scroller)
}

export function startDrag(index: number, e: React.MouseEvent, scroller: HTMLElement | null): void {
  if (e.button !== 0 || !scroller || e.shiftKey) return
  if ((e.target as HTMLElement).closest('button, a, input')) return
  begin(index, e, scroller)
}

function begin(index: number, e: React.MouseEvent, scroller: HTMLElement): void {
  const s = useStore.getState()
  drag = {
    start: index,
    base: e.metaKey || e.ctrlKey ? new Set(s.selected) : new Set(),
    startY: e.clientY,
    moved: false,
    scroller,
    raf: 0,
    y: e.clientY
  }
  const move = (ev: MouseEvent): void => {
    if (!drag) return
    drag.y = ev.clientY
    if (!drag.moved) {
      if (Math.abs(ev.clientY - drag.startY) < 6) return
      drag.moved = true
      document.body.style.cursor = 'ns-resize'
      drag.raf = requestAnimationFrame(tick)
    }
    update()
  }
  const up = (): void => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    if (drag?.moved) suppressClick = true
    if (drag) cancelAnimationFrame(drag.raf)
    document.body.style.cursor = ''
    drag = null
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// ---------- ⌘A context ----------
/** Where the user last clicked: ⌘A selects mails in the list, but the message text in the reading pane. */
let region: 'list' | 'thread' | 'other' = 'list'
export const setRegion = (r: typeof region): void => {
  region = r
}
if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousedown',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-region]')
      region = (el?.dataset.region as typeof region | undefined) ?? 'other'
    },
    true
  )
}

/** Select the text of the newest open message. Returns false when the reading pane isn't the focus. */
export function selectMessageText(): boolean {
  if (region !== 'thread') return false
  const bodies = document.querySelectorAll<HTMLElement>('[data-region="thread"] [data-mail-body]')
  const el = bodies[bodies.length - 1]
  if (!el) return false
  const frame = el.querySelector('iframe')
  if (frame?.contentDocument?.body) {
    frame.contentWindow?.focus()
    frame.contentDocument.getSelection()?.selectAllChildren(frame.contentDocument.body)
  } else {
    window.getSelection()?.selectAllChildren(el)
  }
  return true
}
