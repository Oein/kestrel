import DOMPurify from 'dompurify'

const REMOTE = /^(https?:)?\/\//i
const CSS_REMOTE_URL = /url\(\s*(['"]?)(https?:)?\/\/[^)]*\)/gi

export interface PreparedHtml {
  doc: string
  hasRemote: boolean
}

/**
 * Sanitize mail HTML and wrap it in a standalone document for a sandboxed iframe.
 * Remote resources are blocked unless allowRemote (also enforced by an in-frame CSP).
 */
export function prepareHtml(html: string, allowRemote: boolean): PreparedHtml {
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

  const remote = allowRemote ? ' https: http:' : ''
  const csp = `default-src 'none'; img-src data: blob:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}; media-src data:${remote}`
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html,body{margin:0;padding:0;background:#ffffff;overflow-y:hidden;}
  body{padding:4px 2px 12px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#202124;word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  img[data-blocked]{display:inline-block;min-width:16px;min-height:16px;background:#eceff1;}
  table{max-width:100%;}
  pre{white-space:pre-wrap;}
  blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;}
  a{color:#0b57d0;}
</style></head><body>${clean}</body></html>`
  return { doc, hasRemote }
}

export function linkify(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
}
