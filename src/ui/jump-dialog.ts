import type { RoomSpec, SignalStrategy } from '../core/types'
import { copy } from './copy'
import { el } from './dom'

export type JumpDialog = {
  el: HTMLDialogElement
  open: (prefill?: Partial<RoomSpec> & { needPassword?: boolean }) => void
  close: () => void
}

export function createJumpDialog(onJoin: (spec: RoomSpec) => void): JumpDialog {
  const room = el('input', { placeholder: copy.room, maxlength: 64, autocomplete: 'off' }) as HTMLInputElement
  const password = el('input', { placeholder: copy.password, type: 'password', autocomplete: 'off' }) as HTMLInputElement
  const strategy = el('select', {}, [
    el('option', { value: 'torrent' }, [copy.torrent]),
    el('option', { value: 'nostr' }, [copy.nostr]),
  ]) as HTMLSelectElement
  const form = el('form', { class: 'jump-form', method: 'dialog' }, [
    el('h2', {}, [copy.switch]),
    room,
    password,
    strategy,
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary', type: 'submit' }, [copy.join]),
      el('button', { class: 'btn ghost', type: 'button', value: 'cancel' }, [copy.cancel]),
    ]),
  ])
  const dialog = el('dialog', { class: 'jump' }, [form]) as HTMLDialogElement
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    dialog.close()
    onJoin({
      name: room.value,
      password: password.value,
      strategy: strategy.value as SignalStrategy,
    })
  })
  form.querySelector('button[value="cancel"]')?.addEventListener('click', () => dialog.close())
  return {
    el: dialog,
    open(prefill) {
      room.value = prefill?.name ?? ''
      password.value = prefill?.password ?? ''
      strategy.value = prefill?.strategy ?? 'torrent'
      dialog.showModal()
      if (prefill?.needPassword) password.focus()
      else room.focus()
    },
    close: () => dialog.close(),
  }
}
