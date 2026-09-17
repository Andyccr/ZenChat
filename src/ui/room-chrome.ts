import { loadRecentRooms, specFromRecent, type RecentRoom } from '../core/recent'
import { recentRoomKey } from '../core/room'
import { toHash } from '../core/router'
import { roomUrl, shareOrCopy } from '../core/share'
import type { RoomSpec } from '../core/types'
import { copy } from './copy'
import { el, empty } from './dom'

export function renderTabs(
  nav: HTMLElement,
  active: RoomSpec | undefined,
  handlers: {
    onGo: (spec: RoomSpec) => void
    onNeedPassword: (item: RecentRoom) => void
    onAdd: () => void
  },
): void {
  empty(nav)
  for (const item of loadRecentRooms()) {
    const current = Boolean(active && recentRoomKey(item) === recentRoomKey(active))
    const label = item.hasPassword
      ? [item.name, el('span', { class: 'lock', title: copy.locked }, ['锁'])]
      : [item.name]
    const tab = el(
      'a',
      { class: `tab${current ? ' on' : ''}`, href: toHash({ name: 'room', spec: { name: item.name, password: '', strategy: item.strategy } }) },
      label,
    )
    tab.addEventListener('click', (event) => {
      event.preventDefault()
      const resolved = specFromRecent(item, active)
      if (resolved === 'need-password') {
        handlers.onNeedPassword(item)
        return
      }
      handlers.onGo(resolved)
    })
    nav.append(tab)
  }
  const add = el('button', { class: 'tab add', type: 'button', title: copy.addRoom }, ['+'])
  add.addEventListener('click', () => handlers.onAdd())
  nav.append(add)
}

export function renderTools(
  toolbar: HTMLElement,
  themeBtn: HTMLElement,
  spec: RoomSpec | null,
  onShare: (spec: RoomSpec, withKey: boolean, button: HTMLButtonElement) => void,
): void {
  empty(toolbar)
  toolbar.append(themeBtn)
  if (!spec) return
  const share = el('button', { class: 'btn ghost', type: 'button' }, [copy.share])
  share.addEventListener('click', () => onShare(spec, false, share))
  toolbar.append(share)
  if (spec.password) {
    const shareKey = el('button', { class: 'btn ghost', type: 'button' }, [copy.shareWithKey])
    shareKey.addEventListener('click', () => onShare(spec, true, shareKey))
    toolbar.append(shareKey)
  }
  toolbar.append(el('a', { class: 'btn ghost', href: '#/' }, [copy.leave]))
}

export async function flashShare(spec: RoomSpec, includePassword: boolean, button?: HTMLButtonElement): Promise<void> {
  const url = roomUrl(location.origin, location.pathname, spec, includePassword)
  const result = await shareOrCopy(url)
  if (!button) return
  const original = button.textContent
  button.textContent = result === 'shared' ? copy.shared : result === 'copied' ? copy.copied : copy.copyFailed
  window.setTimeout(() => {
    if (original) button.textContent = original
  }, 1400)
}
