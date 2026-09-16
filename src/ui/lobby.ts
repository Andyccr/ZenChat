import { DEFAULT_ROOM } from '../config/app'
import type { RoomSpec, SignalStrategy } from '../core/types'
import { canJoin } from './capability'
import { copy } from './copy'
import { el } from './dom'

export function buildLobby(options: {
  nick: string
  onJoin: (input: { nick: string; spec: RoomSpec }) => void
}): HTMLElement {
  const nick = el('input', { maxlength: 24, value: options.nick, autocomplete: 'nickname' }) as HTMLInputElement
  const room = el('input', { maxlength: 64, value: DEFAULT_ROOM, autocomplete: 'off' }) as HTMLInputElement
  const password = el('input', { type: 'password', autocomplete: 'off' }) as HTMLInputElement
  const strategy = el('select', {}, [
    el('option', { value: 'torrent' }, [copy.torrent]),
    el('option', { value: 'nostr' }, [copy.nostr]),
  ]) as HTMLSelectElement
  const joinBtn = el('button', { class: 'btn primary join-btn', type: 'submit' }, [copy.join]) as HTMLButtonElement
  if (!canJoin()) joinBtn.disabled = true
  const form = el('form', { class: 'panel form lobby-form' }, [
    el('div', { class: 'join-row' }, [field(copy.nick, nick), field(copy.room, room), joinBtn]),
    el('details', { class: 'more' }, [
      el('summary', {}, [copy.more]),
      el('div', { class: 'row' }, [field(copy.password, password), field(copy.strategy, strategy)]),
      el('span', { class: 'hint' }, [copy.passwordHint]),
    ]),
  ])
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!canJoin()) return
    options.onJoin({
      nick: nick.value,
      spec: {
        name: room.value,
        password: password.value,
        strategy: strategy.value as SignalStrategy,
      },
    })
  })
  return el('div', { class: 'lobby' }, [
    el('p', { class: 'lede' }, [copy.lobbyHint]),
    el('ul', { class: 'tips' }, [
      el('li', {}, [copy.tipSame]),
      el('li', {}, [copy.tipHttps]),
      el('li', {}, [copy.tipNat]),
    ]),
    form,
  ])
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', {}, [label]), control])
}
