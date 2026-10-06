import { useEffect, useLayoutEffect, useRef } from 'react'
import { CommandPalette, Toasts } from './components/Chrome'
import { ComposeLayer } from './components/Compose'
import { AddAccountDialog, openSettings, ReauthBanner, SettingsDialog } from './components/Dialogs'
import { Icon } from './components/Icon'
import { TooltipLayer } from './components/Tooltip'
import { ConfirmLayer } from './components/Confirm'
import { AccountLookEditor, useLookEditor } from './components/AccountLook'
import { btn } from './components/ui'
import { LIST_MIN, PANE_MIN, setDrawer, SIDEBAR_BREAKPOINT, useLayout } from './lib/layout'
import { usePresence } from './lib/motion'
import { setKeyboardNav, setPref, usePrefs } from './lib/prefs'
import { selectAll, selectMessageText, setAnchor } from './lib/selection'
import { MessageList } from './components/MessageList'
import { AccountRail, accountByShortcut, Sidebar } from './components/Sidebar'
import { currentThreadLast, ThreadView } from './components/ThreadView'
import {
  act,
  goRole,
  init,
  moveCursor,
  openCompose,
  openThread,
  reply,
  toggleSelect,
  toggleUnreadOnly,
  undoLast,
  useStore
} from './store'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/** Keyboard shortcuts (Gmail-compatible) + ⌘K / ⌘,. */
function useShortcuts(): void {
  const pendingG = useRef<number>(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useStore.setState({ paletteOpen: !s.paletteOpen })
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete') && !isTyping(e) && !s.paletteOpen) {
        e.preventDefault()
        void act({ type: 'trash' })
        return
      }
      if (e.metaKey && e.key.toLowerCase() === 'a' && !isTyping(e) && !s.paletteOpen && !s.settingsOpen && !s.addAccountOpen) {
        e.preventDefault()
        if (!selectMessageText()) selectAll()
        return
      }
      if (e.metaKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        accountByShortcut(Number(e.key))
        return
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        openSettings()
        return
      }
      if (isTyping(e) || s.paletteOpen || s.addAccountOpen || s.settingsOpen) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0
        const map: Record<string, Parameters<typeof goRole>[0]> = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all' }
        if (key === 'u') {
          e.preventDefault()
          toggleUnreadOnly()
        } else if (map[key]) {
          e.preventDefault()
          goRole(map[key])
        }
        return
      }
      const row = s.rows[s.cursor]
      switch (key) {
        case 'g':
          pendingG.current = Date.now()
          break
        case 'j':
        case 'ArrowDown':
          setKeyboardNav(true)
          moveCursor(1)
          break
        case 'k':
        case 'ArrowUp':
          setKeyboardNav(true)
          moveCursor(-1)
          break
        case 'o':
        case 'Enter':
          if (row) openThread(row.id)
          break
        case 'u':
        case 'Escape':
          if (s.selected.size) useStore.setState({ selected: new Set() })
          else openThread(null)
          break
        case 'e':
          void act({ type: 'archive' })
          break
        case '#':
        case 'Delete':
          void act({ type: 'trash' })
          break
        case 's': {
          const target = s.openId !== null ? s.rows.find((r) => r.id === s.openId) : row
          if (target) void act({ type: 'star', value: !target.starred }, [target.id], { quiet: true })
          break
        }
        case 'x':
          if (row) {
            toggleSelect(row.id)
            setAnchor(s.cursor)
          }
          break
        case 'I':
          void act({ type: 'read', value: true }, undefined, { quiet: true })
          break
        case 'U':
          void act({ type: 'read', value: false }, undefined, { quiet: true })
          if (s.openId !== null && !s.readingPane) openThread(null)
          break
        case 'r':
          if (currentThreadLast) void reply(currentThreadLast, 'reply')
          break
        case 'a':
          if (currentThreadLast) void reply(currentThreadLast, 'replyAll')
          break
        case 'f':
          if (currentThreadLast) void reply(currentThreadLast, 'forward')
          break
        case 'c':
          openCompose()
          break
        case 'z':
          undoLast()
          break
        case '?':
          openSettings('shortcuts')
          break
        case '/':
          window.dispatchEvent(new Event('mailbird:focus-search'))
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Welcome(): React.JSX.Element {
  return (
    <div className="stagger flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-[0_8px_24px_var(--accent-soft)]">
        <Icon name="bird" size={28} stroke={1.9} />
      </span>
      <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">Mailbird</h1>
      <p className="mt-2 max-w-[360px] text-[13.5px] leading-relaxed text-ink-2">
        Gmail, iCloud, 네이버, IMAP 계정을 한곳에서. 모든 메일은 기기에 저장되어 즉시 열리고, 동기화는 뒤에서 조용히 진행됩니다.
      </p>
      <button onClick={() => useStore.setState({ addAccountOpen: true })} className={`${btn.primary} mt-7 h-9 px-5`}>
        첫 계정 연결하기
      </button>
      <div className="mt-10 flex items-center gap-5 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <kbd>⌘</kbd>
          <kbd>K</kbd> 명령
        </span>
        <span className="flex items-center gap-1.5">
          <kbd>C</kbd> 새 메일
        </span>
        <span className="flex items-center gap-1.5">
          <kbd>J</kbd>
          <kbd>K</kbd> 이동
        </span>
      </div>
    </div>
  )
}

function EmptyPane(): React.JSX.Element {
  return (
    <div className="animate-fade flex h-full flex-col items-center justify-center gap-3 text-ink-3">
      <Icon name="bird" size={30} stroke={1.4} className="opacity-50" />
      <div className="flex items-center gap-1.5 text-[12px]">
        <kbd>J</kbd>
        <kbd>K</kbd>로 이동, <kbd>↵</kbd>로 열기
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const accounts = useStore((s) => s.accounts)
  const openId = useStore((s) => s.openId)
  const readingPane = useStore((s) => s.readingPane)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const addAccountOpen = useStore((s) => s.addAccountOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const listWidth = usePrefs((s) => s.listWidth)
  const palette = usePresence(paletteOpen, 110)
  const addAccount = usePresence(addAccountOpen)
  const settings = usePresence(settingsOpen)
  const lookEditor = usePresence(useLookEditor((s) => s.id !== null))
  const { mainWidth, narrow, drawerOpen } = useLayout()
  const drawer = usePresence(narrow && drawerOpen, 160)
  const mainRef = useRef<HTMLElement>(null)
  useShortcuts()

  // responsive layout: track the main area and window width
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    const measure = (): void => {
      const narrowNow = window.innerWidth < SIDEBAR_BREAKPOINT
      useLayout.setState((s) => ({
        mainWidth: el.clientWidth,
        narrow: narrowNow,
        drawerOpen: narrowNow ? s.drawerOpen : false
      }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  // side-by-side only when both panes get a usable width
  const split = readingPane && mainWidth >= LIST_MIN + PANE_MIN
  const effectiveListWidth = Math.max(LIST_MIN, Math.min(listWidth, mainWidth - PANE_MIN))
  useEffect(() => {
    if (useLayout.getState().split !== split) useLayout.setState({ split })
  }, [split])

  useEffect(() => {
    void init()
  }, [])

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = listWidth
    let w = start
    const move = (ev: MouseEvent): void => {
      w = Math.max(LIST_MIN, Math.min(760, start + ev.clientX - startX))
      usePrefs.setState({ listWidth: w })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPref('listWidth', w)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!ready) return <div className="drag h-full bg-bg" />

  return (
    <div className="relative flex h-full">
      <div className="flex h-full shrink-0 bg-sidebar">
        <AccountRail />
        {!narrow && <Sidebar />}
      </div>
      {drawer.mounted && (
        <>
          <div
            className={`fixed inset-0 left-[64px] z-30 bg-black/20 dark:bg-black/40 ${drawer.closing ? 'animate-fade-out' : 'animate-fade'}`}
            onMouseDown={() => setDrawer(false)}
          />
          <div
            className={`fixed inset-y-0 left-[64px] z-40 flex border-r border-line bg-bg shadow-float ${drawer.closing ? 'animate-drawer-out' : 'animate-drawer-in'}`}
            onClickCapture={(e) => {
              // picking a folder/label closes the drawer
              if ((e.target as HTMLElement).closest('nav button')) setTimeout(() => setDrawer(false), 0)
            }}
          >
            <div className="flex h-full bg-sidebar">
              <Sidebar />
            </div>
          </div>
        </>
      )}
      <main ref={mainRef} className="flex min-w-0 flex-1 flex-col border-l border-line bg-bg">
        <ReauthBanner />
        <div className="flex min-h-0 flex-1">
          {accounts.length === 0 ? (
            <div className="drag min-w-0 flex-1">
              <div className="no-drag h-full">
                <Welcome />
              </div>
            </div>
          ) : split ? (
            <>
              <section className="relative shrink-0 border-r border-line bg-surface" style={{ width: effectiveListWidth }}>
                <MessageList />
                <div className="absolute inset-y-0 -right-[3px] z-10 w-[5px] cursor-col-resize" onMouseDown={startResize} />
              </section>
              <section className="min-w-0 flex-1">{openId !== null ? <ThreadView id={openId} /> : <EmptyPane />}</section>
            </>
          ) : (
            <section className="min-w-0 flex-1 bg-surface">{openId !== null ? <ThreadView id={openId} /> : <MessageList />}</section>
          )}
        </div>
      </main>
      <ComposeLayer />
      <Toasts />
      <TooltipLayer />
      <ConfirmLayer />
      {palette.mounted && <CommandPalette closing={palette.closing} />}
      {addAccount.mounted && <AddAccountDialog closing={addAccount.closing} />}
      {settings.mounted && <SettingsDialog closing={settings.closing} />}
      {lookEditor.mounted && <AccountLookEditor closing={lookEditor.closing} />}
    </div>
  )
}
