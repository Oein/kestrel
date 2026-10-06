import { randomBytes } from 'crypto'
import type { ClientCredentials } from '../../oauthClients'
import { BATCH_URL, boundaryFromContentType, buildBatchBody, parseBatchResponse, type BatchRequest, type BatchResponse } from './batch'
import { ReauthRequiredError, refreshAccessToken } from './oauth'

const API = 'https://gmail.googleapis.com'

export class GmailHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface GmailAuthSource {
  credentials(): ClientCredentials
  refreshToken(): string
  onReauthRequired(): void
}

/** Thin REST client over fetch with automatic token refresh and retry/backoff. */
export class GmailApi {
  private accessToken: string | null = null
  private expiresAt = 0
  private refreshing: Promise<string> | null = null

  constructor(private auth: GmailAuthSource) {}

  async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken
    this.refreshing ??= (async () => {
      try {
        const res = await refreshAccessToken(this.auth.credentials(), this.auth.refreshToken())
        this.accessToken = res.access_token
        this.expiresAt = Date.now() + res.expires_in * 1000
        return res.access_token
      } catch (e) {
        if (e instanceof ReauthRequiredError) this.auth.onReauthRequired()
        throw e
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  setAccessToken(token: string, expiresIn: number): void {
    this.accessToken = token
    this.expiresAt = Date.now() + expiresIn * 1000
  }

  async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | string[] | undefined>; body?: unknown } = {}
  ): Promise<T> {
    const url = new URL(API + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
      else url.searchParams.set(k, String(v))
    }
    let attempt = 0
    for (;;) {
      const token = await this.token()
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      })
      if (res.ok) {
        if (res.status === 204) return undefined as T
        const text = await res.text()
        return (text ? JSON.parse(text) : undefined) as T
      }
      if (res.status === 401 && attempt === 0) {
        this.accessToken = null
        attempt++
        continue
      }
      if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 4) {
        const text = await res.text()
        if (res.status === 403 && !/rate|quota/i.test(text)) throw new GmailHttpError(403, text.slice(0, 300))
        await sleep(500 * 2 ** attempt + Math.random() * 250)
        attempt++
        continue
      }
      const text = await res.text().catch(() => '')
      throw new GmailHttpError(res.status, `Gmail API ${res.status}: ${text.slice(0, 300)}`)
    }
  }

  /**
   * Run requests through the batch endpoint (chunks of 50, sequential to respect per-user quota).
   * Items failing with 429/5xx are retried with backoff.
   */
  async batch(requests: BatchRequest[], chunkSize = 50): Promise<BatchResponse[]> {
    const results: BatchResponse[] = new Array(requests.length)
    for (let start = 0; start < requests.length; start += chunkSize) {
      let pending = requests.slice(start, start + chunkSize).map((r, i) => ({ r, index: start + i }))
      for (let attempt = 0; pending.length && attempt < 5; attempt++) {
        if (attempt) await sleep(400 * 2 ** attempt)
        const responses = await this.batchOnce(pending.map((p) => p.r))
        const retry: typeof pending = []
        responses.forEach((resp, i) => {
          const item = pending[resp.index] ?? pending[i]
          if (!item) return
          if ((resp.status === 429 || resp.status >= 500 || resp.status === 403) && attempt < 4) retry.push(item)
          else results[item.index] = { ...resp, index: item.index }
        })
        // anything missing in the response gets retried too
        const seen = new Set(responses.map((r) => r.index))
        pending.forEach((p, i) => {
          if (!seen.has(i) && !retry.includes(p)) retry.push(p)
        })
        pending = retry
      }
      for (const p of pending) results[p.index] = { index: p.index, status: 599, body: null }
    }
    return results
  }

  private async batchOnce(requests: BatchRequest[]): Promise<BatchResponse[]> {
    const boundary = `mailbird_${randomBytes(8).toString('hex')}`
    for (let attempt = 0; ; attempt++) {
      const token = await this.token()
      const res = await fetch(BATCH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/mixed; boundary=${boundary}` },
        body: buildBatchBody(requests, boundary)
      })
      if (res.status === 401 && attempt === 0) {
        this.accessToken = null
        continue
      }
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(500 * 2 ** attempt)
          continue
        }
        throw new GmailHttpError(res.status, `Gmail batch ${res.status}`)
      }
      const respBoundary = boundaryFromContentType(res.headers.get('content-type'))
      if (!respBoundary) throw new Error('batch: missing boundary')
      return parseBatchResponse(await res.text(), respBoundary)
    }
  }
}
