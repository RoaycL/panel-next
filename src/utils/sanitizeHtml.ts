const ALLOWED_TAGS = new Set(['A', 'B', 'BR', 'DIV', 'EM', 'I', 'P', 'SPAN', 'STRONG'])
// 仅保留无害的展示属性；class/style 一律剥离，防止用户 HTML 借用全局样式干扰面板 UI。
const GLOBAL_ATTRIBUTES = new Set(['title'])

function safeLink(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  }
  catch {
    return null
  }
}

/** Allow basic footer formatting without executable tags, handlers or CSS. */
export function sanitizeUserHtml(source: string) {
  if (!source)
    return ''
  const documentFragment = new DOMParser().parseFromString(source, 'text/html')
  for (const element of [...documentFragment.body.querySelectorAll('*')]) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(documentFragment.createTextNode(element.textContent || ''))
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const allowed = GLOBAL_ATTRIBUTES.has(name) || (element.tagName === 'A' && ['href', 'target', 'rel'].includes(name))
      if (!allowed)
        element.removeAttribute(attribute.name)
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href')
      if (!href || !safeLink(href))
        element.removeAttribute('href')
      if (element.getAttribute('target') === '_blank')
        element.setAttribute('rel', 'noopener noreferrer')
      else
        element.removeAttribute('target')
    }
  }
  return documentFragment.body.innerHTML
}
