import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'path'
import type { AppEvents } from '../shared/types'
import { Repo } from './db/repo'
import { registerIpc } from './ipc'
import { MailService } from './mail'
import { OAuthClientService } from './oauthClients'

let mainWindow: BrowserWindow | null = null
let repo: Repo | null = null
let mail: MailService | null = null

function emit<K extends keyof AppEvents>(channel: K, payload: AppEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, payload)
  }
}

function isSafeExternal(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Mailbird',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111317' : '#f6f8fc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => mail?.onFocus())
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
    const shot = process.env.MAILBIRD_SCREENSHOT
    if (shot) {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          for (const key of (process.env.MAILBIRD_SCREENSHOT_KEYS ?? '').split(',').filter(Boolean)) {
            mainWindow?.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
            mainWindow?.webContents.sendInputEvent({ type: 'char', keyCode: key })
            mainWindow?.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
            await new Promise((r) => setTimeout(r, 400))
          }
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

app.setName('Mailbird')
// dev/testing: isolate the profile (e.g. MAILBIRD_USER_DATA=/tmp/mb pnpm dev)
if (!app.isPackaged && process.env.MAILBIRD_USER_DATA) app.setPath('userData', process.env.MAILBIRD_USER_DATA)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    const dbPath = join(app.getPath('userData'), 'mailbird.sqlite')
    repo = new Repo(dbPath)
    const oauth = new OAuthClientService(repo)
    try {
      oauth.importFromEnv()
    } catch (e) {
      console.warn('[oauth] .env import failed', (e as Error).message)
    }
    mail = new MailService(repo, oauth, emit, () => mainWindow)
    registerIpc(ipcMain, repo, mail, oauth)
    createWindow()
    mail.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting || !mail) return
    e.preventDefault()
    quitting = true
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
