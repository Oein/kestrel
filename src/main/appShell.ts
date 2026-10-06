// macOS application menu + menu bar (Tray) icon.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface ShellActions {
  show(): void
  compose(): void
  syncNow(): void
  openSettings(tab?: string): void
  quit(): void
  launchAtLogin(): boolean
  setLaunchAtLogin(on: boolean): void
}

export function buildAppMenu(a: ShellActions): void {
  const isMac = process.platform === 'darwin'
  const dev = !app.isPackaged
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `${app.name} 정보` },
              { type: 'separator' },
              { label: '설정…', accelerator: 'CmdOrCtrl+,', click: () => a.openSettings() },
              { type: 'separator' },
              { role: 'services', label: '서비스' },
              { type: 'separator' },
              { role: 'hide', label: `${app.name} 가리기` },
              { role: 'hideOthers', label: '기타 가리기' },
              { role: 'unhide', label: '모두 보기' },
              { type: 'separator' },
              { label: `${app.name} 종료`, accelerator: 'CmdOrCtrl+Q', click: () => a.quit() }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: '파일',
      submenu: [
        { label: '새 메일', accelerator: 'CmdOrCtrl+N', click: () => a.compose() },
        { label: '지금 동기화', click: () => a.syncNow() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '창 닫기' } : { label: '설정…', accelerator: 'CmdOrCtrl+,', click: () => a.openSettings() },
        ...(isMac ? [] : [{ type: 'separator' } as const, { label: '종료', click: () => a.quit() }])
      ]
    },
    { role: 'editMenu', label: '편집' },
    {
      label: '보기',
      submenu: [
        ...(dev
          ? ([{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' }
      ]
    },
    { role: 'windowMenu', label: '윈도우' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function trayImage(): Electron.NativeImage {
  // read via fs so it also works from inside app.asar; @2x as a second representation
  const dir = join(app.getAppPath(), 'resources')
  const img = nativeImage.createFromBuffer(readFileSync(join(dir, 'trayTemplate.png')), { scaleFactor: 1 })
  try {
    img.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(dir, 'trayTemplate@2x.png')) })
  } catch {
    /* 1x only */
  }
  img.setTemplateImage(true)
  return img
}

export class TrayController {
  private tray: Tray | null = null
  private unread = 0

  constructor(private a: ShellActions) {}

  setVisible(on: boolean): void {
    if (on && !this.tray) {
      try {
        this.tray = new Tray(trayImage())
      } catch (e) {
        console.warn('[tray] failed to create', (e as Error).message)
        return
      }
      this.tray.setToolTip(app.name)
      this.refresh()
      this.setUnread(this.unread)
    } else if (!on && this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  get visible(): boolean {
    return !!this.tray
  }

  setUnread(n: number): void {
    this.unread = n
    if (!this.tray) return
    this.tray.setTitle(n > 0 ? String(n > 999 ? '999+' : n) : '', { fontType: 'monospacedDigit' })
    this.tray.setToolTip(n > 0 ? `${app.name} — 읽지 않은 메일 ${n}개` : app.name)
  }

  /** rebuild the menu (e.g. after the login-item checkbox changed) */
  refresh(): void {
    if (!this.tray) return
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '열기', click: () => this.a.show() },
        { label: '새 메일', click: () => this.a.compose() },
        { label: '지금 동기화', click: () => this.a.syncNow() },
        { type: 'separator' },
        {
          label: '로그인 시 자동 실행',
          type: 'checkbox',
          checked: this.a.launchAtLogin(),
          click: (item) => this.a.setLaunchAtLogin(item.checked)
        },
        { label: '설정…', click: () => this.a.openSettings('general') },
        { type: 'separator' },
        { label: '종료', click: () => this.a.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
