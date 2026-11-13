export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; value: string }

const URL_RE = /https?:\/\/[^\s<>"'）】\]]+/gi

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  const re = new RegExp(URL_RE.source, 'gi')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const raw = match[0]
    const href = trimTrailingPunct(raw)
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    if (isSafeHttpUrl(href)) parts.push({ type: 'link', href, value: href })
    else parts.push({ type: 'text', value: href })
    if (href.length < raw.length) parts.push({ type: 'text', value: raw.slice(href.length) })
    last = match.index + raw.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts.length > 0 ? parts : [{ type: 'text', value: text }]
}

function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?。，、]+$/u, '')
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
