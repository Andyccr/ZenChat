import { MAX_MESSAGE_LENGTH, MAX_NICK_LENGTH } from '../config/app'
import { colorFromId } from '../core/identity'
import type { ChatLine, Member, SendResult, SessionStatus } from '../core/types'
import { copy } from './copy'
import { el, empty, hostOf, wsLabel } from './dom'
import { LogView } from './log-view'
import { StampPicker } from './picker'

export type ChatPaneHandlers = {
  selfId: string
  nick: string
  send: (text: string) => Promise<SendResult>
  typing: () => void
  onRetry: () => void
  onShare: () => void
  onSwitchSignal: () => void
  onNick: (nick: string) => void
  resend: (id: string) => Promise<SendResult>
}

export class ChatPane {
  readonly root: HTMLElement
  readonly log: LogView
  private statusEl: HTMLElement
  private actionsEl: HTMLElement
  private membersEl: HTMLElement
  private selfRow: HTMLElement
  private selfIdEl: HTMLElement
  private vacantEl: HTMLElement
  private peopleBtn: HTMLButtonElement
  private nickInput: HTMLInputElement
  private lastStatus = ''
  private lastPeerCount = 0

  constructor(private handlers: ChatPaneHandlers) {
    this.log = new LogView((id) => {
      void this.handlers.resend(id)
    })
    this.statusEl = el('div', { class: 'status' })
    this.actionsEl = el('div', { class: 'status-actions' })
    this.membersEl = el('div', { class: 'members' })
    this.vacantEl = el('div', { class: 'vacant' }, [copy.waiting])
    this.peopleBtn = el('button', { class: 'btn ghost people', type: 'button', 'aria-expanded': 'false' }, [copy.people])
    this.peopleBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      this.root.classList.toggle('show-side')
      this.peopleBtn.setAttribute('aria-expanded', this.root.classList.contains('show-side') ? 'true' : 'false')
    })
    const composer = el('textarea', {
      rows: 1,
      placeholder: copy.placeholder,
      maxlength: MAX_MESSAGE_LENGTH,
      enterkeyhint: 'send',
      'aria-label': copy.placeholder,
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
      this.handlers.onNick(this.nickInput.value)
      const text = composer.value
      if (!text.trim()) return
      composer.value = ''
      composer.style.height = 'auto'
      picker.hide()
      void this.handlers.send(text).then((result) => {
        if (result === 'failed' || result === 'closed') {
          composer.value = text
        }
      })
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
      this.handlers.typing()
    })

    this.nickInput = el('input', {
      class: 'nick-edit',
      maxlength: MAX_NICK_LENGTH,
      value: handlers.nick,
      'aria-label': copy.nick,
    }) as HTMLInputElement
    const commitNick = () => this.handlers.onNick(this.nickInput.value)
    this.nickInput.addEventListener('change', commitNick)
    this.nickInput.addEventListener('blur', commitNick)
    this.nickInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.nickInput.blur()
      }
    })
    this.selfIdEl = el('span', { class: 'muted' }, [handlers.selfId.slice(0, 8)])
    this.selfRow = el('div', { class: 'member self' }, [
      el('label', { class: 'nick-label' }, [el('span', {}, [copy.you]), this.nickInput]),
      this.selfIdEl,
    ])
    this.membersEl.append(this.selfRow)

    this.root = el('div', { class: 'chat' }, [
      el('section', { class: 'transcript' }, [
        el('div', { class: 'status-row' }, [this.statusEl, this.actionsEl, this.peopleBtn]),
        this.vacantEl,
        this.log.el,
        picker.el,
        el('div', { class: 'composer' }, [stampBtn, composer, sendBtn]),
      ]),
      el('aside', { class: 'side' }, [
        el('h2', {}, [copy.members]),
        this.membersEl,
      ]),
    ])
  }

  hide(): void {
    this.root.hidden = true
    this.root.classList.remove('show-side')
    this.peopleBtn.setAttribute('aria-expanded', 'false')
  }

  show(): void {
    this.root.hidden = false
  }

  push(line: ChatLine): void {
    this.log.append(line)
    this.vacantEl.hidden = true
  }

  reset(lines: ChatLine[]): void {
    this.log.reset(lines)
    this.vacantEl.hidden = lines.length > 0 || this.lastPeerCount > 0
  }

  setNick(nick: string): void {
    if (document.activeElement !== this.nickInput) this.nickInput.value = nick
  }

  status(status: SessionStatus): void {
    const open = status.relays.filter((relay) => relay.readyState === WebSocket.OPEN).length
    const key = `${status.phase}|${status.detail}|${status.peerCount}|${open}|${this.log.size}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.lastPeerCount = status.peerCount
    const tone = status.phase === 'connected' ? ' ok' : status.phase === 'error' ? ' err' : ''
    this.statusEl.replaceChildren(
      el('i', { class: `dot${tone}` }),
      el('span', {}, [` ${status.detail}`]),
    )
    this.peopleBtn.textContent = `${copy.people} ${status.peerCount}`
    this.statusEl.title = status.relays.map((relay) => `${hostOf(relay.url)} ${wsLabel(relay.readyState)}`).join('\n')
    this.renderActions(status)
    this.vacantEl.hidden = status.peerCount > 0 || this.log.size > 0
  }

  members(list: Member[], selfId: string): void {
    this.selfIdEl.textContent = selfId.slice(0, 8)
    while (this.membersEl.lastChild && this.membersEl.lastChild !== this.selfRow) {
      this.membersEl.removeChild(this.membersEl.lastChild)
    }
    for (const member of list) {
      this.membersEl.append(
        el('div', { class: 'member' }, [
          el('b', { style: `color:${colorFromId(member.id)}` }, [member.nick]),
          el('span', { class: 'muted' }, [member.typing ? copy.typing : member.rttMs !== null ? `${Math.round(member.rttMs)}ms` : '']),
        ]),
      )
    }
  }

  private renderActions(status: SessionStatus): void {
    empty(this.actionsEl)
    if (status.phase === 'error') {
      this.actionsEl.append(
        actionButton(copy.retry, this.handlers.onRetry),
        actionButton(copy.switchSignal, this.handlers.onSwitchSignal),
      )
      return
    }
    if (status.phase === 'connecting' && status.peerCount === 0) {
      this.actionsEl.append(actionButton(copy.share, this.handlers.onShare))
    }
  }
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', { class: 'btn ghost compact', type: 'button' }, [label]) as HTMLButtonElement
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  return button
}
