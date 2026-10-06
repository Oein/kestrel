import { useEffect, useRef, useState } from 'react'
import { CommandPalette, Toasts, TopBar } from './components/Chrome'
import { ComposeLayer } from './components/Compose'
import { AddAccountDialog, ReauthBanner, SettingsDialog } from './components/Dialogs'
import { Icon } from './components/Icon'
import { MessageList } from './components/MessageList'
import { Sidebar } from './components/Sidebar'
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
  undoLast,
  useStore
} from './store'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/** Gmail keyboard shortcuts + ⌘K. */
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
      if (isTyping(e) || s.paletteOpen || s.addAccountOpen || s.settingsOpen) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0
        const map: Record<string, Parameters<typeof goRole>[0]> = { i: 'inbox', s: 'starred', t: 'sent', d: 'drafts', a: 'all' }
        if (map[key]) {
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
          moveCursor(1)
          break
        case 'k':
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
          if (row) toggleSelect(row.id)
          break
        case 'I':
          void act({ type: 'read', value: true }, undefined, { quiet: true })
          break
        case 'U':
          void act({ type: 'read', value: false }, undefined, { quiet: true })
          if (s.openId !== null && !s.readingPane) openThread(null)
          break
        case 'r':
          if (currentThreadLast) reply(currentThreadLast, 'reply')
          break
        case 'a':
          if (currentThreadLast) reply(currentThreadLast, 'replyAll')
          break
        case 'f':
          if (currentThreadLast) reply(currentThreadLast, 'forward')
          break
        case 'c':
          openCompose()
          break
        case 'z':
          undoLast()
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
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0b57d0] text-white shadow-lg">
        <Icon name="send" size={32} />
      </div>
      <h1 className="text-2xl font-medium">Mailbird에 오신 것을 환영합니다</h1>
      <p className="max-w-md text-[14px] opacity-70">
        Gmail, iCloud, 네이버 또는 IMAP 계정을 추가하세요. 모든 메일은 기기에 캐시되어 즉시 열리고, 백그라운드에서 동기화됩니다.
      </p>
      <button
        onClick={() => useStore.setState({ addAccountOpen: true })}
        className="rounded-full bg-[#0b57d0] px-6 py-2.5 font-medium text-white shadow hover:bg-[#0a4ebb]"
      >
        계정 추가
      </button>
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
  const [listWidth, setListWidth] = useState(() => Number(localStorage.getItem('mailbird.listWidth')) || 440)
  useShortcuts()

  useEffect(() => {
    void init()
  }, [])

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = listWidth
    let w = start
    const move = (ev: MouseEvent): void => {
      w = Math.max(320, Math.min(900, start + ev.clientX - startX))
      setListWidth(w)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      localStorage.setItem('mailbird.listWidth', String(w))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!ready) return <div className="drag h-full" />

  const panel = 'min-h-0 overflow-hidden rounded-2xl bg-white dark:bg-[#1b1e24]'

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ReauthBanner />
        <div className="flex min-h-0 flex-1 gap-2 pb-3 pr-3">
          {accounts.length === 0 ? (
            <div className={`${panel} flex-1`}>
              <Welcome />
            </div>
          ) : readingPane ? (
            <>
              <div className={`${panel} shrink-0`} style={{ width: listWidth }}>
                <MessageList />
              </div>
              <div className="-mx-1.5 w-1 shrink-0 cursor-col-resize" onMouseDown={startResize} />
              <div className={`${panel} min-w-0 flex-1 bg-[#f8fafd] dark:bg-[#16181d]`}>
                {openId !== null ? (
                  <ThreadView id={openId} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] opacity-40">
                    <Icon name="all" size={44} />
                    선택된 대화가 없습니다
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className={`${panel} flex-1`}>{openId !== null ? <ThreadView id={openId} /> : <MessageList />}</div>
          )}
        </div>
      </main>
      <ComposeLayer />
      <Toasts />
      {paletteOpen && <CommandPalette />}
      {addAccountOpen && <AddAccountDialog />}
      {settingsOpen && <SettingsDialog />}
    </div>
  )
}
