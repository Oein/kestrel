import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** Parse a dotenv-style file. Values are never logged. */
export function parseEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function candidates(): string[] {
  const list = [join(process.cwd(), '.env')]
  try {
    list.push(join(app.getAppPath(), '.env'))
    list.push(join(app.getPath('userData'), '.env'))
  } catch {
    /* app not ready */
  }
  return list
}

export interface EnvGoogleClient {
  /** null for the unsuffixed GOOGLE_CLIENT_ID */
  suffix: string | null
  clientId: string
  clientSecret: string
  domains: string[]
}

/** Read every Google OAuth client from .env. Values are never logged. */
export function readEnvGoogleClients(): EnvGoogleClient[] {
  const env: Record<string, string> = {}
  for (const p of candidates().reverse()) {
    if (existsSync(p)) Object.assign(env, parseEnv(readFileSync(p, 'utf8')))
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('GOOGLE_CLIENT_') && v) env[k] = v
  return extractGoogleClients(env)
}

/** GOOGLE_CLIENT_ID[_SUFFIX] / GOOGLE_CLIENT_SECRET[_SUFFIX] / GOOGLE_CLIENT_DOMAINS[_SUFFIX] */
export function extractGoogleClients(env: Record<string, string>): EnvGoogleClient[] {
  const out: EnvGoogleClient[] = []
  for (const [key, value] of Object.entries(env)) {
    const m = /^GOOGLE_CLIENT_ID(?:_([A-Z0-9_]+))?$/.exec(key)
    if (!m || !value || value.startsWith('your-')) continue
    const suffix = m[1] ?? null
    const sfx = suffix ? `_${suffix}` : ''
    out.push({
      suffix,
      clientId: value,
      clientSecret: env[`GOOGLE_CLIENT_SECRET${sfx}`] ?? '',
      domains: (env[`GOOGLE_CLIENT_DOMAINS${sfx}`] ?? '')
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    })
  }
  // unsuffixed first
  return out.sort((a, b) => (a.suffix === null ? -1 : b.suffix === null ? 1 : a.suffix.localeCompare(b.suffix)))
}
