import { colorFromId } from '../core/identity'
import type { ChatLine } from '../core/types'
import { el, formatTime } from './dom'
import { isStamp } from './stickers'

export class LogView {
  readonly el: HTMLElement
  private ids = new Set<string>()

  constructor() {
    this.el = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' })
  }

  reset(lines: ChatLine[]): void {
    this.el.replaceChildren()
    this.ids.clear()
    for (const line of lines) this.append(line, false)
    this.stick()
  }

  append(line: ChatLine, stick = true): void {
    if (this.ids.has(line.id)) return
    this.ids.add(line.id)
    this.el.append(renderLine(line))
    if (stick) this.stick()
  }

  private stick(): void {
    const node = this.el
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    if (nearBottom) node.scrollTop = node.scrollHeight
  }
}

function renderLine(line: ChatLine): HTMLElement {
  if (line.kind === 'system') {
    return el('div', { class: 'system' }, [line.text])
  }
  const stamp = isStamp(line.text)
  return el('article', { class: `bubble${line.self ? ' self' : ''}${stamp ? ' stamp' : ''}` }, [
    el('header', {}, [
      el('b', { style: `color:${colorFromId(line.fromId)}` }, [line.nick]),
      el('time', {}, [formatTime(line.ts)]),
    ]),
    el('p', {}, [line.text]),
  ])
}
