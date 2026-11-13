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
  private composer: HTMLTextAreaElement
  private sendBtn: HTMLButtonElement
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
    this.composer = el('textarea', {
      rows: 1,
      id: 'composer',
      name: 'message',
      placeholder: copy.placeholder,
      maxlength: MAX_MESSAGE_LENGTH,
      enterkeyhint: 'send',
      'aria-label': copy.placeholder,
    }) as HTMLTextAreaElement
    this.composer.setAttribute('enterkeyhint', 'send')
    this.composer.setAttribute('autocapitalize', 'sentences')
    this.composer.disabled = true
    this.composer.placeholder = copy.connecting
    const picker = new StampPicker(this.composer)
    const stampBtn = el('button', { class: 'btn ghost', type: 'button', title: copy.stamps }, ['顔'])
    this.sendBtn = el('button', { class: 'btn primary send', type: 'button', 'aria-label': copy.send }, ['↑']) as HTMLButtonElement
    this.sendBtn.disabled = true
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
      if (this.composer.disabled) return
      this.handlers.onNick(this.nickInput.value)
      const text = this.composer.value
      if (!text.trim()) return
      this.composer.value = ''
      this.composer.style.height = 'auto'
      picker.hide()
      void this.handlers.send(text).then((result) => {
        if (result === 'failed' || result === 'closed') {
          this.composer.value = text
        }
      })
    }
    this.sendBtn.addEventListener('click', send)
    this.composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        send()
      }
    })
    this.composer.addEventListener('input', () => {
      this.composer.style.height = 'auto'
      this.composer.style.height = `${Math.min(this.composer.scrollHeight, 96)}px`
      this.handlers.typing()
    })

    this.nickInput = el('input', {
      class: 'nick-edit',
      id: 'chat-nick',
      name: 'nick',
      maxlength: MAX_NICK_LENGTH,
      value: handlers.nick,
      'aria-label': copy.nick,
      autocomplete: 'nickname',
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
        el('div', { class: 'composer' }, [stampBtn, this.composer, this.sendBtn]),
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
    const key = `${status.phase}|${status.detail}|${status.peerCount}|${open}|${status.canSend}|${this.log.size}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.lastPeerCount = status.peerCount
    this.composer.disabled = !status.canSend
    this.sendBtn.disabled = !status.canSend
    this.composer.placeholder = status.canSend ? copy.placeholder : copy.connecting
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
