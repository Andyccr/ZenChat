export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | undefined> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key === 'class') {
      node.className = String(value)
      continue
    }
    if (typeof value === 'boolean') {
      node.toggleAttribute(key, value)
      continue
    }
    if (key === 'style') {
      node.setAttribute('style', String(value))
      continue
    }
    if (key in node && key !== 'list') {
      ;(node as unknown as Record<string, unknown>)[key] = value
      continue
    }
    node.setAttribute(key, String(value))
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function empty(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ts)
}

export function wsLabel(readyState: number): string {
  switch (readyState) {
    case WebSocket.CONNECTING:
      return '连接中'
    case WebSocket.OPEN:
      return '已连接'
    case WebSocket.CLOSING:
      return '断开中'
    default:
      return '未连接'
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
