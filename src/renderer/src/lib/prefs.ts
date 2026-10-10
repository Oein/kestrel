// View preferences that only affect the renderer (kept in localStorage, no IPC round trip).
import { create } from 'zustand'

export type Density = 'comfortable' | 'compact'

interface Prefs {
  density: Density
  listWidth: number
  /** sidebar entries the user chose to hide: `role:junk`, `label:<mailboxId>`, `labels:<accountId>` */
  sidebarHidden: string[]
  /** per-account icon overrides chosen by the user */
  accountLooks: Record<string, AccountLook>
}

export interface AccountLook {
  text?: string // 1–2 characters
  icon?: string // key of ACCOUNT_ICONS
  color?: string
  image?: string // small data: URL
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(`kestrel.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export const usePrefs = create<Prefs>(() => ({
  density: read<Density>('density', 'comfortable'),
  listWidth: read<number>('listWidth', 420),
  sidebarHidden: read<string[]>('sidebarHidden', []),
  accountLooks: read<Record<string, AccountLook>>('accountLooks', {})
}))

export function setAccountLook(id: string, look: AccountLook | null): void {
  const all = { ...usePrefs.getState().accountLooks }
  if (look) all[id] = look
  else delete all[id]
  setPref('accountLooks', all)
}

/** Colour used for an account everywhere (dots, marks): the user's override or the stored one. */
export function useAccountColor(): (a: { id: string; color: string }) => string {
  const looks = usePrefs((s) => s.accountLooks)
  return (a) => looks[a.id]?.color ?? a.color
}

export function toggleSidebarHidden(key: string, hide?: boolean): void {
  const cur = new Set(usePrefs.getState().sidebarHidden)
  const on = hide ?? !cur.has(key)
  if (on) cur.add(key)
  else cur.delete(key)
  setPref('sidebarHidden', [...cur])
}

/** True while the user drives the list with the keyboard; the cursor outline is only shown then. */
export const useKeyboardNav = create<{ on: boolean }>(() => ({ on: false }))
export const setKeyboardNav = (on: boolean): void => {
  if (useKeyboardNav.getState().on !== on) useKeyboardNav.setState({ on })
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>)
  try {
    localStorage.setItem(`kestrel.${key}`, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep in memory */
  }
}
