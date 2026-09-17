import { MAX_ROOM_LENGTH } from '../config/app'
import { canonicalizeSpec } from '../core/room'
import type { RoomSpec, SignalStrategy } from '../core/types'
import { canJoin } from './capability'
import { copy } from './copy'
import { el } from './dom'

export type JumpDialog = {
  el: HTMLDialogElement
  open: (prefill?: Partial<RoomSpec> & { needPassword?: boolean }) => void
  close: () => void
}

export function createJumpDialog(onJoin: (spec: RoomSpec) => void): JumpDialog {
  const room = el('input', { placeholder: copy.room, maxlength: MAX_ROOM_LENGTH, autocomplete: 'off' }) as HTMLInputElement
  const password = el('input', { placeholder: copy.password, type: 'password', autocomplete: 'off' }) as HTMLInputElement
  const strategy = el('select', {}, [
    el('option', { value: 'torrent' }, [copy.torrent]),
    el('option', { value: 'nostr' }, [copy.nostr]),
  ]) as HTMLSelectElement
  const hint = el('p', { class: 'hint hidden' }, [copy.needPassword])
  const joinBtn = el('button', { class: 'btn primary', type: 'submit' }, [copy.join]) as HTMLButtonElement
  if (!canJoin()) joinBtn.disabled = true
  const form = el('form', { class: 'jump-form', method: 'dialog' }, [
    el('h2', {}, [copy.switch]),
    hint,
    room,
    password,
    strategy,
    el('div', { class: 'actions' }, [
      joinBtn,
      el('button', { class: 'btn ghost', type: 'button', value: 'cancel' }, [copy.cancel]),
    ]),
  ])
  const dialog = el('dialog', { class: 'jump' }, [form]) as HTMLDialogElement
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!canJoin()) return
    const spec = canonicalizeSpec({
      name: room.value,
      password: password.value,
      strategy: strategy.value as SignalStrategy,
    })
    if (!spec) {
      room.focus()
      return
    }
    dialog.close()
    onJoin(spec)
  })
  form.querySelector('button[value="cancel"]')?.addEventListener('click', () => dialog.close())
  return {
    el: dialog,
    open(prefill) {
      room.value = prefill?.name ?? ''
      password.value = prefill?.password ?? ''
      strategy.value = prefill?.strategy ?? 'torrent'
      hint.classList.toggle('hidden', !prefill?.needPassword)
      dialog.showModal()
      if (prefill?.needPassword) password.focus()
      else room.focus()
    },
    close: () => dialog.close(),
  }
}
