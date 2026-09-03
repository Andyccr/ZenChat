import { colorFromId } from '../core/identity'
import type { Member, SessionStatus } from '../core/types'
import { copy } from './copy'
import { el, hostOf, wsLabel } from './dom'
import { LogView } from './log-view'
import { StampPicker } from './picker'

export class ChatPane {
  readonly root: HTMLElement
  readonly log = new LogView()
  private statusEl: HTMLElement
  private membersEl: HTMLElement
  private peopleBtn: HTMLButtonElement
  private lastStatus = ''

  constructor(options: { selfId: string; send: (text: string) => void; typing: () => void }) {
    this.statusEl = el('div', { class: 'status' })
    this.membersEl = el('div', { class: 'members' })
    this.peopleBtn = el('button', { class: 'btn ghost people', type: 'button' }, [copy.people])
    this.peopleBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      this.root.classList.toggle('show-side')
    })
    const composer = el('textarea', {
      rows: 1,
      placeholder: copy.placeholder,
      maxlength: 4000,
      enterkeyhint: 'send',
    }) as HTMLTextAreaElement
    composer.setAttribute('enterkeyhint', 'send')
    composer.setAttribute('autocapitalize', 'sentences')
    const picker = new StampPicker(composer)
    const stampBtn = el('button', { class: 'btn ghost', type: 'button', title: copy.stamps }, ['顔'])
    const sendBtn = el('button', { class: 'btn primary send', type: 'button', 'aria-label': copy.send }, ['↑'])
    stampBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      picker.toggle()
    })
    this.peopleBtn.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.addEventListener('pointerdown', (event) => {
      if (!this.root.contains(event.target as Node)) return
      if (!(event.target as HTMLElement).closest('.picker, .people, .side')) picker.hide()
    })
    picker.el.addEventListener('click', (event) => event.stopPropagation())

    const send = () => {
      const text = composer.value
      composer.value = ''
      composer.style.height = 'auto'
      picker.hide()
      options.send(text)
    }
    sendBtn.addEventListener('click', send)
    composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        send()
      }
    })
    composer.addEventListener('input', () => {
      composer.style.height = 'auto'
      composer.style.height = `${Math.min(composer.scrollHeight, 96)}px`
      options.typing()
    })

    this.root = el('div', { class: 'chat' }, [
      el('section', { class: 'transcript' }, [
        el('div', { class: 'status-row' }, [this.statusEl, this.peopleBtn]),
        this.log.el,
        picker.el,
        el('div', { class: 'composer' }, [stampBtn, composer, sendBtn]),
      ]),
      el('aside', { class: 'side' }, [
        el('h2', {}, [copy.members]),
        this.membersEl,
      ]),
    ])
    this.members([], options.selfId)
  }

  hide(): void {
    this.root.hidden = true
    this.root.classList.remove('show-side')
  }

  show(): void {
    this.root.hidden = false
  }

  status(status: SessionStatus): void {
    const open = status.relays.filter((relay) => relay.readyState === WebSocket.OPEN).length
    const key = `${status.phase}|${status.detail}|${status.peerCount}|${open}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.statusEl.replaceChildren(
      el('i', { class: `dot${status.peerCount > 0 ? ' ok' : ''}` }),
      el('span', {}, [` ${status.detail}`]),
    )
    this.peopleBtn.textContent = `${copy.people} ${status.peerCount}`
    this.statusEl.title = status.relays.map((relay) => `${hostOf(relay.url)} ${wsLabel(relay.readyState)}`).join('\n')
  }

  members(list: Member[], selfId: string): void {
    this.membersEl.replaceChildren(
      el('div', { class: 'member' }, [
        el('b', {}, [copy.you]),
        el('span', { class: 'muted' }, [selfId.slice(0, 8)]),
      ]),
      ...list.map((member) =>
        el('div', { class: 'member' }, [
          el('b', { style: `color:${colorFromId(member.id)}` }, [member.nick]),
          el('span', { class: 'muted' }, [member.typing ? '输入中' : member.rttMs !== null ? `${Math.round(member.rttMs)}ms` : '']),
        ]),
      ),
    )
  }
}
