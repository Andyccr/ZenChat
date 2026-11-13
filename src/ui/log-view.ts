import { colorFromId } from '../core/identity'
import type { ChatLine } from '../core/types'
import { copy } from './copy'
import { el, formatTime } from './dom'
import { splitLinks } from './linkify'
import { isNearBottom } from './scroll'
import { isStamp } from './stickers'

export class LogView {
  readonly el: HTMLElement
  private ids = new Set<string>()
  private nodes = new Map<string, HTMLElement>()

  constructor(private onResend?: (id: string) => void) {
    this.el = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' })
  }

  get size(): number {
    return this.ids.size
  }

  reset(lines: ChatLine[]): void {
    this.el.replaceChildren()
    this.ids.clear()
    this.nodes.clear()
    for (const line of lines) this.append(line, false)
    this.scrollToEnd()
  }

  append(line: ChatLine, stick = true): void {
    const follow =
      stick &&
      ((line.kind === 'chat' && line.self) ||
        isNearBottom(this.el.scrollTop, this.el.scrollHeight, this.el.clientHeight))
    if (this.ids.has(line.id)) {
      this.replace(line)
      return
    }
    this.ids.add(line.id)
    const node = this.render(line)
    this.nodes.set(line.id, node)
    this.el.append(node)
    if (follow) this.scrollToEnd()
  }

  private replace(line: ChatLine): void {
    const previous = this.nodes.get(line.id)
    if (!previous) return
    const next = this.render(line)
    this.nodes.set(line.id, next)
    previous.replaceWith(next)
  }

  private render(line: ChatLine): HTMLElement {
    return renderLine(line, this.onResend)
  }

  private scrollToEnd(): void {
    const node = this.el
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }
}

function renderLine(line: ChatLine, onResend?: (id: string) => void): HTMLElement {
  if (line.kind === 'system') {
    return el('div', { class: 'system', 'data-id': line.id }, [line.text])
  }
  const stamp = isStamp(line.text)
  const mark = deliveryMark(line, onResend)
  const header = el('header', {}, [
    el('b', { style: `color:${colorFromId(line.fromId)}` }, [line.nick]),
    el('time', {}, [formatTime(line.ts)]),
    ...(mark ? [mark] : []),
  ])
  const node = el('article', { class: `bubble${line.self ? ' self' : ''}${stamp ? ' stamp' : ''}${line.delivery === 'failed' ? ' failed' : ''}`, 'data-id': line.id }, [
    header,
    el('p', {}, stamp ? [line.text] : nodesFromText(line.text)),
  ])
  if (line.self && line.delivery === 'failed' && onResend) {
    node.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a, button')) return
      onResend(line.id)
    })
  }
  return node
}

function nodesFromText(text: string): Array<Node | string> {
  return splitLinks(text).map((part) => {
    if (part.type === 'text') return part.value
    const link = el('a', { href: part.href, target: '_blank', rel: 'noreferrer noopener' }, [part.value])
    link.addEventListener('click', (event) => event.stopPropagation())
    return link
  })
}

function deliveryMark(line: Extract<ChatLine, { kind: 'chat' }>, onResend?: (id: string) => void): HTMLElement | null {
  if (!line.self || !line.delivery) return null
  if (line.delivery === 'acked') return el('span', { class: 'delivery' }, [copy.delivered])
  if (line.delivery === 'pending') return el('span', { class: 'delivery pending' }, [copy.sending])
  const button = el('button', { class: 'delivery fail', type: 'button', title: copy.resend }, [copy.undelivered])
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onResend?.(line.id)
  })
  return button
}
