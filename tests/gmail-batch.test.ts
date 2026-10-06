import { describe, expect, it } from 'vitest'
import { boundaryFromContentType, buildBatchBody, parseBatchResponse } from '../src/main/providers/gmail/batch'

describe('gmail batch', () => {
  it('builds a multipart batch body', () => {
    const body = buildBatchBody(
      [
        { method: 'GET', path: '/gmail/v1/users/me/messages/a?format=metadata' },
        { method: 'POST', path: '/gmail/v1/users/me/messages/b/modify', body: { addLabelIds: ['STARRED'] } }
      ],
      'BOUNDARY'
    )
    expect(body).toContain('--BOUNDARY\r\nContent-Type: application/http\r\nContent-ID: <item-0>\r\n\r\nGET /gmail/v1/users/me/messages/a?format=metadata HTTP/1.1\r\n')
    expect(body).toContain('Content-ID: <item-1>')
    expect(body).toContain('{"addLabelIds":["STARRED"]}')
    expect(body.endsWith('--BOUNDARY--\r\n')).toBe(true)
  })

  it('extracts the boundary', () => {
    expect(boundaryFromContentType('multipart/mixed; boundary=batch_abc')).toBe('batch_abc')
    expect(boundaryFromContentType('multipart/mixed; boundary="q u"')).toBe('q u')
    expect(boundaryFromContentType(null)).toBeNull()
  })

  it('parses a batch response (out of order, errors, empty bodies)', () => {
    const b = 'batch_XYZ'
    const text = [
      `--${b}`,
      'Content-Type: application/http',
      'Content-ID: <response-item-1>',
      '',
      'HTTP/1.1 404 Not Found',
      'Content-Type: application/json; charset=UTF-8',
      '',
      '{"error":{"code":404,"message":"Requested entity was not found."}}',
      `--${b}`,
      'Content-Type: application/http',
      'Content-ID: <response-item-0>',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json; charset=UTF-8',
      'Vary: Origin',
      '',
      '{',
      '  "id": "abc",',
      '  "threadId": "t1",',
      '  "labelIds": ["INBOX", "UNREAD"],',
      '  "snippet": "안녕 &amp; 반가워"',
      '}',
      `--${b}`,
      'Content-Type: application/http',
      'Content-ID: <response-item-2>',
      '',
      'HTTP/1.1 204 No Content',
      '',
      '',
      `--${b}--`,
      ''
    ].join('\r\n')
    const res = parseBatchResponse(text, b)
    expect(res.map((r) => [r.index, r.status])).toEqual([
      [0, 200],
      [1, 404],
      [2, 204]
    ])
    expect(res[0].body).toMatchObject({ id: 'abc', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] })
    expect((res[1].body as { error: { code: number } }).error.code).toBe(404)
    expect(res[2].body).toBeNull()
  })
})
