import { copy } from './copy'
import { el } from './dom'
import { EMOJI, insertAtCursor, KAOMOJI } from './stickers'

export class StampPicker {
  readonly el: HTMLElement
  private open = false

  constructor(field: HTMLTextAreaElement) {
    const kao = el(
      'div',
      { class: 'picker-grid kaomoji' },
      KAOMOJI.map((item) => stampButton(item, () => insertAtCursor(field, item))),
    )
    const emo = el(
      'div',
      { class: 'picker-grid emoji hidden' },
      EMOJI.map((item) => stampButton(item, () => insertAtCursor(field, item))),
    )
    const kaoTab = el('button', { class: 'tab on', type: 'button' }, [copy.kaomoji])
    const emoTab = el('button', { class: 'tab', type: 'button' }, [copy.emoji])
    kaoTab.addEventListener('click', () => {
      kao.classList.remove('hidden')
      emo.classList.add('hidden')
      kaoTab.classList.add('on')
      emoTab.classList.remove('on')
    })
    emoTab.addEventListener('click', () => {
      emo.classList.remove('hidden')
      kao.classList.add('hidden')
      emoTab.classList.add('on')
      kaoTab.classList.remove('on')
    })
    this.el = el('div', { class: 'picker hidden', role: 'dialog', 'aria-label': copy.stamps }, [
      el('div', { class: 'picker-tabs' }, [kaoTab, emoTab]),
      kao,
      emo,
    ])
  }

  toggle(): void {
    this.open = !this.open
    this.el.classList.toggle('hidden', !this.open)
  }

  hide(): void {
    this.open = false
    this.el.classList.add('hidden')
  }
}

function stampButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', { class: 'stamp-btn', type: 'button' }, [label])
  button.addEventListener('click', onClick)
  return button
}
