// App-level preferences stored in the kv table (notifications, launch at login, menu bar).
import { app } from 'electron'
import type { AppSettings } from '../shared/types'
import type { Repo } from './db/repo'

export const DEFAULT_SETTINGS: AppSettings = { notifications: true, launchAtLogin: false, keepInMenuBar: true }
const KEY = 'appSettings'

export class SettingsService {
  private cache: AppSettings

  constructor(
    private repo: Repo,
    private onChange: (s: AppSettings) => void
  ) {
    this.cache = { ...DEFAULT_SETTINGS, ...repo.getKv<Partial<AppSettings>>(KEY, {}) }
    // the user can also toggle the login item in System Settings; trust the OS in packaged builds
    if (app.isPackaged && process.platform === 'darwin') {
      this.cache.launchAtLogin = app.getLoginItemSettings().openAtLogin
    }
  }

  get(): AppSettings {
    return { ...this.cache }
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = { ...this.cache }
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (typeof patch[k] === 'boolean') next[k] = patch[k]
    }
    if (next.launchAtLogin !== this.cache.launchAtLogin) applyLoginItem(next.launchAtLogin)
    this.cache = next
    this.repo.setKv(KEY, next)
    this.onChange(this.get())
    return this.get()
  }
}

/**
 * Register / unregister the login item. Only meaningful for a packaged (and, on recent macOS, signed) app:
 * in dev this would register the bare Electron binary, so it is skipped.
 */
function applyLoginItem(on: boolean): void {
  if (!app.isPackaged) {
    console.log(`[settings] launchAtLogin=${on} saved (login item is only registered in a packaged build)`)
    return
  }
  // (openAsHidden no longer exists; macOS reports wasOpenedAtLogin instead, Windows gets --hidden)
  app.setLoginItemSettings({ openAtLogin: on, ...(process.platform === 'win32' ? { args: ['--hidden'] } : {}) })
}

/** Started by the login item → start hidden in the menu bar. */
export function launchedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true
  if (process.platform !== 'darwin' || !app.isPackaged) return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true
  } catch {
    return false
  }
}
