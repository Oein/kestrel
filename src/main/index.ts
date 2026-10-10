import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'path'
import type { AppEvents } from '../shared/types'
import { buildAppMenu, TrayController, type ShellActions } from './appShell'
import { Repo } from './db/repo'
import { seedDemo } from './demo'
import { registerIpc } from './ipc'
import { MailService } from './mail'
import { Notifier } from './notify'
import { OAuthClientService } from './oauthClients'
import { RuleEngine } from './rules/engine'
import { JsRunner } from './rules/jsRunner'
import { PythonRunner } from './rules/python'
import { launchedAtLogin, SettingsService } from './settings'

let mainWindow: BrowserWindow | null = null
let repo: Repo | null = null
let mail: MailService | null = null
let settings: SettingsService | null = null
let tray: TrayController | null = null
let jsRunner: JsRunner | null = null
/** set once a real quit starts (⌘Q, tray 종료, OS shutdown) so window close stops hiding */
let quitting = false
/** start hidden in the menu bar (launched by the login item) */
let startHidden = false

function emit<K extends keyof AppEvents>(channel: K, payload: AppEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, payload)
  }
}

function isSafeExternal(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url)
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true)
  const w = mainWindow!
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

const isMac = process.platform === 'darwin'

function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    // KESTREL_WINDOW=WxH (dev only) to check responsive layouts
    width: (!app.isPackaged && Number(process.env.KESTREL_WINDOW?.split('x')[0])) || 1360,
    height: (!app.isPackaged && Number(process.env.KESTREL_WINDOW?.split('x')[1])) || 860,
    minWidth: 560,
    minHeight: 480,
    show: false,
    title: 'Kestrel',
    // macOS: translucent sidebar (the renderer body is transparent); elsewhere an opaque background
    ...(isMac
      ? {
          vibrancy: 'sidebar' as const,
          visualEffectState: 'followWindow' as const,
          backgroundColor: '#00000000',
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 19 }
        }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#181715' : '#fbfaf8' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })
  if (show) mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => mail?.onFocus())
  mainWindow.on('close', (e) => {
    if (quitting) return
    if (settings?.get().keepInMenuBar) {
      // keep running (and syncing) in the menu bar
      e.preventDefault()
      if (mainWindow?.isFullScreen()) {
        mainWindow.once('leave-full-screen', () => mainWindow?.hide())
        mainWindow.setFullScreen(false)
      } else mainWindow?.hide()
    } else {
      setImmediate(() => app.quit())
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))

  // never navigate the app window; open links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      e.preventDefault()
      if (isSafeExternal(url)) void shell.openExternal(url)
    }
  })
  // iframes (mail bodies) must not navigate either
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && e.url !== 'about:srcdoc' && !e.url.startsWith('about:')) {
      e.preventDefault()
      if (isSafeExternal(e.url)) void shell.openExternal(e.url)
    }
  })

  if (!app.isPackaged) {
    // surface renderer problems in the dev terminal
    mainWindow.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`)
    })
    mainWindow.webContents.on('render-process-gone', (_e, d) => console.log('[renderer] gone', d.reason))
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => console.log('[renderer] failed to load', code, desc))
    const shot = process.env.KESTREL_SCREENSHOT
    if (shot) {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          for (const key of (process.env.KESTREL_SCREENSHOT_KEYS ?? '').split(',').filter(Boolean)) {
            mainWindow?.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
            mainWindow?.webContents.sendInputEvent({ type: 'char', keyCode: key })
            mainWindow?.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
            await new Promise((r) => setTimeout(r, 400))
          }
          // KESTREL_SCREENSHOT_MOUSE="x,y" hovers a point (CSS px) before capturing, e.g. to check tooltips
          const mouse = process.env.KESTREL_SCREENSHOT_MOUSE?.split(',').map(Number)
          if (mouse?.length === 2) mainWindow?.webContents.sendInputEvent({ type: 'mouseMove', x: mouse[0], y: mouse[1] })
          await new Promise((r) => setTimeout(r, 1000))
          const img = await mainWindow?.webContents.capturePage()
          if (img) (await import('fs')).writeFileSync(shot, img.toPNG())
          console.log('[dev] screenshot saved')
        }, 3000)
      })
    }
  }

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName('Kestrel')
// notifications are attributed to this id (Windows); on macOS the bundle name is used
if (process.platform === 'win32') app.setAppUserModelId('kr.oein.kestrel')
// dev/testing: isolate the profile (e.g. KESTREL_USER_DATA=/tmp/mb pnpm dev)
if (!app.isPackaged && process.env.KESTREL_USER_DATA) app.setPath('userData', process.env.KESTREL_USER_DATA)
// dev/design: `KESTREL_DEMO=1 pnpm dev` opens a separate profile filled with fake mail, with syncing off
const demo = !app.isPackaged && !!process.env.KESTREL_DEMO
if (demo && !process.env.KESTREL_USER_DATA) app.setPath('userData', join(app.getPath('appData'), 'Kestrel-demo'))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    // packaged builds get the icon from the bundle; in dev the dock would show Electron's
    if (!app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
    const dbPath = join(app.getPath('userData'), 'kestrel.sqlite')
    repo = new Repo(dbPath)
    const oauth = new OAuthClientService(repo)
    try {
      oauth.importFromEnv()
    } catch (e) {
      console.warn('[oauth] .env import failed', (e as Error).message)
    }
    if (demo) seedDemo(repo)
    const r = repo
    const m = (mail = new MailService(r, oauth, emit, () => mainWindow, demo))

    const actions: ShellActions = {
      show: showWindow,
      compose: () => {
        showWindow()
        emit('app:compose', {})
      },
      syncNow: () => m.syncAll(),
      openSettings: (tab) => {
        showWindow()
        emit('app:openSettings', tab ? { tab } : {})
      },
      quit: () => app.quit(),
      launchAtLogin: () => settings?.get().launchAtLogin ?? false,
      setLaunchAtLogin: (on) => settings?.set({ launchAtLogin: on })
    }
    tray = new TrayController(actions)
    settings = new SettingsService(r, (st) => {
      tray?.setVisible(st.keepInMenuBar)
      tray?.refresh()
      emit('settings:changed', st)
    })
    buildAppMenu(actions)

    const notifier = new Notifier(r, () => settings?.get().notifications ?? true, () => mainWindow, showWindow, emit)
    jsRunner = new JsRunner()
    const rules = new RuleEngine(r, {
      js: jsRunner,
      python: new PythonRunner(join(app.getPath('userData'), 'rules')),
      ensureLabel: (accountId, name) => m.ensureLabel(accountId, name),
      commit: (changes) => m.commitRuleChanges(changes),
      emit
    })
    m.rules = rules
    m.notifier = notifier
    m.onUnreadCount = (n) => tray?.setUnread(n)

    registerIpc(ipcMain, r, m, oauth, { settings, rules, notifier })
    tray.setVisible(settings.get().keepInMenuBar)
    // launched by the login item: stay in the menu bar (unless there is no tray to get back in)
    startHidden = launchedAtLogin() && settings.get().keepInMenuBar
    createWindow(!startHidden)
    m.updateBadge()
    if (!demo) m.start()

    app.on('activate', () => showWindow())
  })

  let flushed = false
  app.on('before-quit', (e) => {
    quitting = true
    if (flushed || !mail) return
    e.preventDefault()
    flushed = true
    jsRunner?.dispose()
    tray?.destroy()
    // commit delayed (undo-able) actions and sends before quitting
    void mail.stop().finally(() => {
      repo?.close()
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
