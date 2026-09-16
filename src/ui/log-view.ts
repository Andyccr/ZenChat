import { colorFromId } from '../core/identity'
import type { ChatLine } from '../core/types'
import { copy } from './copy'
import { el, formatTime } from './dom'
import { isStamp } from './stickers'

export class LogView {
  readonly el: HTMLElement
  private ids = new Set<string>()
  private nodes = new Map<string, HTMLElement>()

  constructor() {
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
    this.stick()
  }

  append(line: ChatLine, stick = true): void {
    if (this.ids.has(line.id)) {
      this.replace(line)
      return
    }
    this.ids.add(line.id)
    const node = renderLine(line)
    this.nodes.set(line.id, node)
    this.el.append(node)
    if (stick) this.stick()
  }

  private replace(line: ChatLine): void {
    const previous = this.nodes.get(line.id)
    if (!previous) return
    const next = renderLine(line)
    this.nodes.set(line.id, next)
    previous.replaceWith(next)
  }

  private stick(): void {
    const node = this.el
    requestAnimationFrame(() => {
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 96
      if (nearBottom) node.scrollTop = node.scrollHeight
    })
  }
}

function renderLine(line: ChatLine): HTMLElement {
  if (line.kind === 'system') {
    return el('div', { class: 'system', 'data-id': line.id }, [line.text])
  }
  const stamp = isStamp(line.text)
  const mark =
    line.self && line.delivery === 'acked'
      ? el('span', { class: 'delivery' }, [copy.delivered])
      : line.self && line.delivery === 'failed'
        ? el('span', { class: 'delivery fail' }, [copy.undelivered])
        : null
  const header = el('header', {}, [
    el('b', { style: `color:${colorFromId(line.fromId)}` }, [line.nick]),
    el('time', {}, [formatTime(line.ts)]),
    ...(mark ? [mark] : []),
  ])
  return el('article', { class: `bubble${line.self ? ' self' : ''}${stamp ? ' stamp' : ''}${line.delivery === 'failed' ? ' failed' : ''}`, 'data-id': line.id }, [
    header,
    el('p', {}, [line.text]),
  ])
}
