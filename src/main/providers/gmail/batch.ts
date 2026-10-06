// Gmail HTTP batch endpoint helpers: https://developers.google.com/gmail/api/guides/batch

export interface BatchRequest {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  /** path relative to host, e.g. /gmail/v1/users/me/messages/abc?format=metadata */
  path: string
  body?: unknown
}

export interface BatchResponse {
  /** index into the original request array */
  index: number
  status: number
  body: unknown
}

export const BATCH_URL = 'https://www.googleapis.com/batch/gmail/v1'

export function buildBatchBody(requests: BatchRequest[], boundary: string): string {
  let out = ''
  requests.forEach((r, i) => {
    out += `--${boundary}\r\n`
    out += 'Content-Type: application/http\r\n'
    out += `Content-ID: <item-${i}>\r\n\r\n`
    out += `${r.method} ${r.path} HTTP/1.1\r\n`
    if (r.body !== undefined) {
      const json = JSON.stringify(r.body)
      out += 'Content-Type: application/json\r\n'
      out += `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`
      out += json + '\r\n'
    } else {
      out += '\r\n'
    }
  })
  out += `--${boundary}--\r\n`
  return out
}

export function boundaryFromContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  return m ? (m[1] ?? m[2]) : null
}

/** Parse a multipart/mixed batch response into individual responses. */
export function parseBatchResponse(text: string, boundary: string): BatchResponse[] {
  const out: BatchResponse[] = []
  const parts = text.split(`--${boundary}`)
  for (let part of parts) {
    part = part.replace(/^\r?\n/, '')
    if (!part.trim() || part.startsWith('--')) continue
    // outer part headers
    const sep = part.search(/\r?\n\r?\n/)
    if (sep < 0) continue
    const outerHeaders = part.slice(0, sep)
    const rest = part.slice(sep).replace(/^\r?\n\r?\n/, '')
    const idMatch = /Content-ID:\s*<?response-item-(\d+)>?/i.exec(outerHeaders)
    // inner HTTP response
    const statusMatch = /^HTTP\/[\d.]+\s+(\d{3})/.exec(rest)
    if (!statusMatch) continue
    const innerSep = rest.search(/\r?\n\r?\n/)
    const bodyText = innerSep >= 0 ? rest.slice(innerSep).replace(/^\r?\n\r?\n/, '').trim() : ''
    let body: unknown = bodyText
    if (bodyText.startsWith('{') || bodyText.startsWith('[')) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        /* keep text */
      }
    } else if (!bodyText) body = null
    out.push({ index: idMatch ? Number(idMatch[1]) : out.length, status: Number(statusMatch[1]), body })
  }
  return out.sort((a, b) => a.index - b.index)
}
