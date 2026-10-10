import { shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import type { ClientCredentials } from '../../oauthClients'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
  'profile'
]

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

export class ReauthRequiredError extends Error {
  constructor(message = '다시 로그인해야 합니다.') {
    super(message)
  }
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let activeServer: Server | null = null
let activeReject: ((e: Error) => void) | null = null

export function cancelAuth(): void {
  activeReject?.(new Error('로그인이 취소되었습니다.'))
}

const PAGE = (title: string, msg: string): string => `<!doctype html><html lang="ko"><meta charset="utf-8">
<title>Kestrel</title><body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f8fc">
<div style="text-align:center"><h2>${title}</h2><p style="color:#5f6368">${msg}</p></div></body></html>`

/** OAuth 2.0 for installed apps: loopback redirect + PKCE. */
export async function authorize(client: ClientCredentials, loginHint?: string): Promise<TokenResponse> {
  cancelAuth()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  return await new Promise<TokenResponse>((resolve, reject) => {
    let settled = false
    const server = createServer()
    activeServer = server
    const finish = (err: Error | null, tok?: TokenResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeReject = null
      setTimeout(() => server.close(), 500)
      if (activeServer === server) activeServer = null
      if (err) reject(err)
      else resolve(tok!)
    }
    activeReject = (e) => finish(e)
    const timer = setTimeout(() => finish(new Error('로그인 시간이 초과되었습니다.')), 5 * 60_000)

    server.on('request', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error || !code || url.searchParams.get('state') !== state) {
        res.end(PAGE('로그인 실패', '앱으로 돌아가 다시 시도하세요.'))
        finish(new Error(error === 'access_denied' ? '권한 요청이 거부되었습니다.' : '로그인에 실패했습니다.'))
        return
      }
      res.end(PAGE('로그인 완료', '이 창을 닫고 Kestrel로 돌아가세요.'))
      try {
        const port = (server.address() as AddressInfo).port
        const body = new URLSearchParams({
          code,
          client_id: client.clientId,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: `http://127.0.0.1:${port}`
        })
        if (client.clientSecret) body.set('client_secret', client.clientSecret)
        const r = await fetch(TOKEN_URL, { method: 'POST', body })
        const json = (await r.json()) as TokenResponse & { error?: string; error_description?: string }
        if (!r.ok) throw new Error(`토큰 교환 실패: ${json.error_description ?? json.error ?? r.status}`)
        if (!json.refresh_token) throw new Error('refresh token을 받지 못했습니다. 다시 시도하세요.')
        finish(null, json)
      } catch (e) {
        finish(e as Error)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      })
      if (loginHint) params.set('login_hint', loginHint)
      void shell.openExternal(`${AUTH_URL}?${params.toString()}`)
    })
    server.on('error', (e) => finish(e))
  })
}

export async function refreshAccessToken(client: ClientCredentials, refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const r = await fetch(TOKEN_URL, { method: 'POST', body })
  const json = (await r.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!r.ok) {
    if (json.error === 'invalid_grant' || json.error === 'unauthorized_client' || json.error === 'invalid_client') {
      throw new ReauthRequiredError()
    }
    throw new Error(`토큰 갱신 실패 (${r.status})`)
  }
  return json
}

/** Decode id_token claims (no verification needed: received directly from Google over TLS). */
export function decodeIdToken(idToken: string | undefined): { email?: string; name?: string } {
  if (!idToken) return {}
  try {
    const payload = idToken.split('.')[1]
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return {}
  }
}
