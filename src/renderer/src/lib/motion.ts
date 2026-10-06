import { useEffect, useRef, useState } from 'react'

/**
 * Keep a component mounted for `ms` after `show` turns false so it can play an exit animation.
 * `closing` is true during that window.
 */
export function usePresence(show: boolean, ms = 140): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(show)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (show) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, ms)
    return () => clearTimeout(t)
  }, [show]) // eslint-disable-line react-hooks/exhaustive-deps
  return { mounted: show || mounted, closing: !show && closing }
}

/** Items that were removed from `list` stay around for `ms` flagged as leaving (for exit animations). */
export function useLeaving<T extends { id: number }>(list: T[], ms = 160): (T & { leaving?: boolean })[] {
  const prev = useRef<T[]>(list)
  const [leaving, setLeaving] = useState<T[]>([])
  useEffect(() => {
    const ids = new Set(list.map((x) => x.id))
    const gone = prev.current.filter((x) => !ids.has(x.id))
    prev.current = list
    if (!gone.length) return
    setLeaving((l) => [...l, ...gone])
    const t = setTimeout(() => setLeaving((l) => l.filter((x) => !gone.includes(x))), ms)
    return () => clearTimeout(t)
  }, [list, ms])
  return [...list, ...leaving.map((x) => ({ ...x, leaving: true }))]
}
