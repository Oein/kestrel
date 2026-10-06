import DOMPurify from 'dompurify'

const REMOTE = /^(https?:)?\/\//i
const CSS_REMOTE_URL = /url\(\s*(['"]?)(https?:)?\/\/[^)]*\)/gi

export interface PreparedHtml {
  doc: string
  hasRemote: boolean
  /** how the body is shown: 'light' = original, 'adapted' = recoloured for dark mode, 'paper' = designed mail kept on a light sheet */
  mode: 'light' | 'adapted' | 'paper'
}

// ---------- dark mode adaptation ----------
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  red: [255, 0, 0], navy: [0, 0, 128], blue: [0, 0, 255], green: [0, 128, 0], maroon: [128, 0, 0], purple: [128, 0, 128]
}

function parseColor(v: string | null | undefined): [number, number, number, number] | null {
  if (!v) return null
  const c = v.trim().toLowerCase()
  if (!c || c === 'inherit' || c === 'initial' || c === 'currentcolor') return null
  if (c === 'transparent') return [0, 0, 0, 0]
  if (NAMED[c]) return [...NAMED[c], 1]
  let m = /^#([0-9a-f]{3,8})$/.exec(c)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = /^rgba?\(([^)]+)\)$/.exec(c)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x))
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  return null
}

const lum = ([r, g, b]: number[]): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Light text for dark mode: keep hue, flip lightness. */
function invertText(c: [number, number, number, number]): string {
  const l = lum(c)
  if (l > 0.55) return `rgb(${c[0]},${c[1]},${c[2]})`
  const mix = 0.92 - l * 0.6 // dark grey/black -> near white, mid tones -> lighter
  const f = (x: number): number => Math.round(x + (255 - x) * mix)
  return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`
}

function bgOf(el: HTMLElement): string | null {
  return el.getAttribute('bgcolor') || el.style.backgroundColor || (/^#|^rgb|^[a-z]+$/i.test(el.style.background) ? el.style.background : null)
}

/**
 * Decide how to show a sanitized body in dark mode. Plain mails (only white/transparent backgrounds) get their
 * colours rewritten; designed newsletters keep their own palette on a light sheet so nothing becomes unreadable.
 */
function adaptForDark(body: HTMLElement): 'adapted' | 'paper' {
  const els = [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))]
  let designed = 0
  for (const el of els) {
    const bg = parseColor(bgOf(el))
    if (bg && bg[3] > 0.05 && lum(bg) < 0.9) designed++
    if (el.style.backgroundImage && el.style.backgroundImage !== 'none') designed++
  }
  if (designed > 2) return 'paper'
  for (const el of els) {
    if (el.hasAttribute('bgcolor')) el.removeAttribute('bgcolor')
    el.style.removeProperty('background-color')
    if (parseColor(el.style.background)) el.style.removeProperty('background')
    const fc = parseColor(el.getAttribute('color'))
    if (fc) el.setAttribute('color', invertText(fc))
    const tc = parseColor(el.style.color)
    if (tc) el.style.color = invertText(tc)
    const bc = parseColor(el.style.borderColor)
    if (bc && lum(bc) > 0.6) el.style.borderColor = 'rgba(255,255,255,.14)'
  }
  return 'adapted'
}

/**
 * Sanitize mail HTML and wrap it in a standalone document for a sandboxed iframe.
 * Remote resources are blocked unless allowRemote (also enforced by an in-frame CSP).
 */
export function prepareHtml(html: string, allowRemote: boolean, dark = false): PreparedHtml {
  let hasRemote = false
  const purify = DOMPurify()
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const name = data.attrName
    if ((name === 'src' || name === 'srcset' || name === 'background' || name === 'poster') && REMOTE.test(data.attrValue)) {
      hasRemote = true
      if (!allowRemote) {
        ;(node as Element).setAttribute('data-blocked', '1')
        data.attrValue = ''
      }
    }
    if (name === 'style' && CSS_REMOTE_URL.test(data.attrValue)) {
      hasRemote = true
      CSS_REMOTE_URL.lastIndex = 0
      if (!allowRemote) data.attrValue = data.attrValue.replace(CSS_REMOTE_URL, 'none')
    }
    CSS_REMOTE_URL.lastIndex = 0
  })
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && node.textContent && CSS_REMOTE_URL.test(node.textContent)) {
      hasRemote = true
      CSS_REMOTE_URL.lastIndex = 0
      if (!allowRemote) node.textContent = node.textContent.replace(CSS_REMOTE_URL, 'none')
    }
    CSS_REMOTE_URL.lastIndex = 0
  })
  const clean = purify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target', 'bgcolor', 'background', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'width', 'height'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link', 'frame', 'frameset'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  }) as string

  let body = clean
  let mode: PreparedHtml['mode'] = 'light'
  if (dark) {
    const tmp = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
    mode = adaptForDark(tmp.body)
    if (mode === 'adapted') body = tmp.body.innerHTML
  }
  const adapted = mode === 'adapted'
  const remote = allowRemote ? ' https: http:' : ''
  const csp = `default-src 'none'; img-src data: blob:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}; media-src data:${remote}`
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root{color-scheme:${adapted ? 'dark' : 'light'};}
  html,body{margin:0;padding:0;background:${adapted ? 'transparent' : '#ffffff'};overflow-y:hidden;}
  body{padding:${mode === 'paper' ? '16px 18px 20px' : '2px 0 12px'};font-family:'Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:14px;line-height:1.65;color:${adapted ? '#e7e4de' : '#1b1a17'};word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  img[data-blocked]{display:inline-block;min-width:16px;min-height:16px;background:${adapted ? 'rgba(255,255,255,.08)' : '#efece6'};border-radius:4px;}
  table{max-width:100%;}
  pre{white-space:pre-wrap;}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid ${adapted ? 'rgba(255,255,255,.18)' : '#dcd8cf'};padding-left:1.2ex;color:${adapted ? '#a9a59c' : '#5f5b53'};}
  hr{border:0;border-top:1px solid ${adapted ? 'rgba(255,255,255,.12)' : '#e4e0d8'};}
  a{color:${adapted ? '#ff9a76' : '#c4431f'};}
</style></head><body>${body}</body></html>`
  return { doc, hasRemote, mode }
}

export function linkify(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
}
