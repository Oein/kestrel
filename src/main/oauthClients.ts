import { randomUUID } from 'crypto'
import type { OAuthClient, OAuthClientInput } from '../shared/types'
import type { Repo } from './db/repo'
import { readEnvGoogleClients } from './env'
import { decryptSecret, encryptSecret } from './secrets'

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

const normDomains = (d: string[]): string =>
  d
    .map((x) => x.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
    .join(',')

export class OAuthClientService {
  constructor(private repo: Repo) {}

  /**
   * Seed clients from .env (GOOGLE_CLIENT_ID[_SUFFIX] ...). Idempotent: skips client ids that already
   * exist or were imported before (so a client deleted in the UI is not resurrected).
   */
  importFromEnv(): void {
    const env = readEnvGoogleClients()
    if (!env.length) return
    const imported = new Set(this.repo.getKv<string[]>('env_imported_client_ids', []))
    const existing = new Set(this.repo.oauthClientRows().map((r) => r.client_id))
    let n = 0
    for (const c of env) {
      if (existing.has(c.clientId) || imported.has(c.clientId)) continue
      const isDefault = c.suffix === null && !this.repo.oauthClientRows().some((r) => r.is_default)
      this.repo.upsertOAuthClient({
        id: randomUUID(),
        name: c.suffix ? `${c.suffix} (.env)` : '기본 (.env)',
        client_id: c.clientId,
        client_secret: c.clientSecret ? encryptSecret({ secret: c.clientSecret }) : null,
        domains: normDomains(c.domains),
        is_default: isDefault ? 1 : 0
      })
      imported.add(c.clientId)
      n++
    }
    this.repo.setKv('env_imported_client_ids', [...imported])
    if (n) console.log(`[oauth] imported ${n} OAuth client(s) from .env`)
  }

  list(): OAuthClient[] {
    const usage = this.repo.oauthClientUsage()
    return this.repo.oauthClientRows().map((r) => ({
      id: r.id,
      name: r.name,
      clientId: r.client_id,
      hasSecret: !!r.client_secret,
      domains: r.domains ? r.domains.split(',') : [],
      isDefault: !!r.is_default,
      accountCount: usage.get(r.id) ?? 0
    }))
  }

  save(input: OAuthClientInput): OAuthClient {
    const clientId = input.clientId.trim()
    if (!clientId) throw new Error('클라이언트 ID를 입력하세요.')
    if (!input.name.trim()) throw new Error('이름을 입력하세요.')
    const id = input.id ?? randomUUID()
    const existing = input.id ? this.repo.oauthClientRow(input.id) : undefined
    if (input.id && !existing) throw new Error('OAuth 클라이언트를 찾을 수 없습니다.')
    const secret = input.clientSecret.trim()
    this.repo.upsertOAuthClient({
      id,
      name: input.name.trim(),
      client_id: clientId,
      // editing with an empty secret keeps the stored one
      client_secret: secret ? encryptSecret({ secret }) : existing ? undefined : null,
      domains: normDomains(input.domains),
      is_default: input.isDefault ? 1 : 0
    })
    return this.list().find((c) => c.id === id)!
  }

  remove(id: string): void {
    const used = this.repo.listAccounts().filter((a) => a.oauthClientId === id)
    if (used.length) {
      throw new Error(`이 클라이언트를 사용하는 계정이 있어 삭제할 수 없습니다: ${used.map((a) => a.email).join(', ')}`)
    }
    this.repo.deleteOAuthClient(id)
  }

  setDefault(id: string): void {
    this.repo.setDefaultOAuthClient(id)
  }

  /** Domain match first, else the default client. */
  pick(email: string): string | null {
    const rows = this.repo.oauthClientRows()
    const domain = email.split('@')[1]?.trim().toLowerCase()
    if (domain) {
      const match = rows.find((r) => r.domains.split(',').filter(Boolean).includes(domain))
      if (match) return match.id
    }
    return rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null
  }

  credentials(id: string): ClientCredentials {
    const row = this.repo.oauthClientRow(id)
    if (!row) throw new Error('이 계정에 연결된 OAuth 클라이언트가 삭제되었습니다. 설정에서 클라이언트를 다시 추가하세요.')
    const secret = decryptSecret<{ secret: string }>(row.client_secret)
    return { clientId: row.client_id, clientSecret: secret?.secret ?? '' }
  }
}
