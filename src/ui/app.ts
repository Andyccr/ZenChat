import { DEFAULT_ROOM, SOURCE_URL } from '../config/app'
import { loadIdentity, persistNick } from '../core/identity'
import { loadRecentRooms, specFromRecent } from '../core/recent'
import { normalizeRoomName } from '../core/room'
import { RoomManager } from '../core/room-manager'
import { parseHash, toHash } from '../core/router'
import { withSecret, rememberSecret } from '../core/secrets'
import { roomUrl, shareOrCopy } from '../core/share'
import { watchDuplicateTab } from '../core/tab-guard'
import type { RoomSpec, SignalStrategy, ThemePreference } from '../core/types'
import { ChatPane } from './chat-pane'
import { copy } from './copy'
import { el, empty } from './dom'
import { applyTheme, cycleTheme, loadThemePreference, persistThemePreference, themeLabel } from './theme'

function webrtcReady(): boolean {
  return typeof RTCPeerConnection === 'function'
}

function canJoin(): boolean {
  return window.isSecureContext && webrtcReady()
}

export class App {
  private root: HTMLElement
  private theme: ThemePreference
  private identity = loadIdentity()
  private manager: RoomManager
  private themeBtn: HTMLButtonElement
  private tabsEl: HTMLElement
  private toolsEl: HTMLElement
  private main: HTMLElement
  private jump: HTMLDialogElement
  private jumpRoom: HTMLInputElement
  private jumpPass: HTMLInputElement
  private jumpStrategy: HTMLSelectElement
  private footerEl: HTMLElement
  private dupBanner: HTMLElement
  private chat: ChatPane | null = null
  private lobbyEl: HTMLElement | null = null
  private routing = false
  private stopTabWatch: (() => void) | null = null

  constructor(root: HTMLElement) {
    this.root = root
    this.theme = loadThemePreference()
    applyTheme(this.theme)
    this.themeBtn = el('button', { class: 'btn ghost', type: 'button', title: copy.theme }, [themeLabel(this.theme)])
    this.tabsEl = el('nav', { class: 'tabs', 'aria-label': copy.recent })
    this.toolsEl = el('div', { class: 'toolbar' })
    this.main = el('main', { class: 'main' })
    this.jumpRoom = el('input', { placeholder: copy.room, maxlength: 64, autocomplete: 'off' }) as HTMLInputElement
    this.jumpPass = el('input', { placeholder: copy.password, type: 'password', autocomplete: 'off' }) as HTMLInputElement
    this.jumpStrategy = el('select', {}, [
      el('option', { value: 'torrent' }, [copy.torrent]),
      el('option', { value: 'nostr' }, [copy.nostr]),
    ]) as HTMLSelectElement
    this.jump = this.buildJump()
    this.dupBanner = el('div', { class: 'banner warn hidden' }, [copy.duplicateTab])
    this.footerEl = el('p', { class: 'footer' }, [
      el('a', { href: SOURCE_URL, target: '_blank', rel: 'noreferrer' }, [copy.source]),
      ' · AGPL-3.0',
    ])
    this.manager = new RoomManager(this.identity, {
      onStatus: (status) => this.chat?.status(status),
      onMembers: (members) => this.chat?.members(members, this.manager.getSession()?.selfId ?? this.identity.id),
      onLine: (line) => this.chat?.push(line),
      onReset: (lines) => this.chat?.reset(lines),
    })
  }

  start(): void {
    this.mount()
    this.stopTabWatch = watchDuplicateTab(() => this.dupBanner.classList.remove('hidden'))
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(this.theme))
    window.addEventListener('hashchange', () => {
      if (!this.routing) void this.route()
    })
    window.addEventListener('pagehide', () => {
      this.stopTabWatch?.()
      this.manager.snapshot()
      void this.manager.close()
    })
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) void this.route()
    })
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        this.openJump()
      }
      if (event.key === 'Escape') this.jump.close()
    })
    this.themeBtn.addEventListener('click', () => {
      this.theme = cycleTheme(this.theme)
      persistThemePreference(this.theme)
      applyTheme(this.theme)
      this.themeBtn.textContent = themeLabel(this.theme)
    })
    void this.route()
  }

  private mount(): void {
    this.root.append(
      el('div', { class: 'shell' }, [
        el('header', { class: 'topbar' }, [
          el('a', { class: 'brand', href: '#/' }, [
            el('div', { class: 'enso', 'aria-hidden': 'true' }),
            el('strong', {}, [copy.title]),
            el('span', { class: 'tagline' }, [copy.tagline]),
          ]),
          this.tabsEl,
          this.toolsEl,
        ]),
        this.capabilityBanner(),
        this.dupBanner,
        this.main,
        this.footerEl,
      ]),
      this.jump,
    )
  }

  private capabilityBanner(): HTMLElement {
    if (!window.isSecureContext) return el('div', { class: 'banner' }, [copy.insecure])
    if (!webrtcReady()) return el('div', { class: 'banner' }, [copy.webrtcMissing])
    return el('div')
  }

  private buildJump(): HTMLDialogElement {
    const form = el('form', { class: 'jump-form', method: 'dialog' }, [
      el('h2', {}, [copy.switch]),
      this.jumpRoom,
      this.jumpPass,
      this.jumpStrategy,
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', type: 'submit' }, [copy.join]),
        el('button', { class: 'btn ghost', type: 'button', value: 'cancel' }, [copy.cancel]),
      ]),
    ])
    const dialog = el('dialog', { class: 'jump' }, [form]) as HTMLDialogElement
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const spec: RoomSpec = {
        name: this.jumpRoom.value,
        password: this.jumpPass.value,
        strategy: this.jumpStrategy.value as SignalStrategy,
      }
      dialog.close()
      this.go(spec)
    })
    form.querySelector('button[value="cancel"]')?.addEventListener('click', () => dialog.close())
    return dialog
  }

  private openJump(prefill?: Partial<RoomSpec> & { needPassword?: boolean }): void {
    this.jumpRoom.value = prefill?.name ?? ''
    this.jumpPass.value = prefill?.password ?? ''
    this.jumpStrategy.value = prefill?.strategy ?? 'torrent'
    this.jump.showModal()
    if (prefill?.needPassword) this.jumpPass.focus()
    else this.jumpRoom.focus()
  }

  private async route(): Promise<void> {
    const route = parseHash(location.hash)
    this.refreshTabs()
    this.refreshTools(route.name === 'room' ? withSecret(route.spec) : null)
    if (route.name === 'lobby') {
      await this.manager.close()
      this.showLobby()
      return
    }
    const spec = this.stripPasswordFromHash(withSecret(route.spec))
    await this.showChat(spec)
  }

  private stripPasswordFromHash(spec: RoomSpec): RoomSpec {
    rememberSecret(spec)
    const clean = toHash({ name: 'room', spec }, false)
    if (spec.password && location.hash !== clean) {
      this.routing = true
      history.replaceState(null, '', `${location.pathname}${location.search}${clean}`)
      this.routing = false
    }
    return spec
  }

  private go(spec: RoomSpec): void {
    rememberSecret(spec)
    const next = toHash({ name: 'room', spec }, false)
    if (location.hash === next) {
      void this.showChat(spec)
      return
    }
    this.routing = true
    location.hash = next
    this.routing = false
    void this.showChat(spec)
  }

  private showLobby(): void {
    this.chat?.hide()
    this.footerEl.hidden = false
    this.root.classList.remove('mode-chat')
    if (!this.lobbyEl) this.lobbyEl = this.buildLobby()
    else this.lobbyEl.replaceWith((this.lobbyEl = this.buildLobby()))
    this.main.replaceChildren(this.lobbyEl)
    this.refreshTabs()
  }

  private async showChat(spec: RoomSpec): Promise<void> {
    if (!this.chat) {
      this.chat = new ChatPane({
        selfId: this.identity.id,
        nick: this.identity.nick,
        send: (text) => this.manager.getSession()?.sendChat(text) ?? Promise.resolve('closed'),
        typing: () => this.manager.getSession()?.sendTyping(),
        onRetry: () => {
          const current = this.manager.current() ?? spec
          void this.manager.open(current, true)
        },
        onShare: () => {
          const current = this.manager.current() ?? spec
          void this.shareRoom(current, false)
        },
        onSwitchSignal: () => {
          const current = this.manager.current() ?? spec
          this.go({
            ...current,
            strategy: current.strategy === 'torrent' ? 'nostr' : 'torrent',
          })
        },
        onNick: (nick) => {
          this.identity = { ...this.identity, nick: persistNick(nick) }
          this.manager.setIdentity(this.identity)
          this.chat?.setNick(this.identity.nick)
        },
      })
    } else {
      this.chat.setNick(this.identity.nick)
    }
    this.lobbyEl = null
    this.footerEl.hidden = true
    this.root.classList.add('mode-chat')
    this.main.replaceChildren(this.chat.root)
    this.chat.show()
    this.refreshTabs(spec)
    this.refreshTools(spec)
    try {
      await this.manager.open(spec)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '连接失败'
      this.chat.status({
        phase: 'error',
        detail: `无法启动 P2P：${detail}`,
        relays: [],
        peerCount: 0,
      })
    }
  }

  private buildLobby(): HTMLElement {
    const nick = el('input', { maxlength: 24, value: this.identity.nick, autocomplete: 'nickname' }) as HTMLInputElement
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
      this.identity = { ...this.identity, nick: persistNick(nick.value) }
      this.manager.setIdentity(this.identity)
      this.go({
        name: room.value,
        password: password.value,
        strategy: strategy.value as SignalStrategy,
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

  private refreshTabs(active?: RoomSpec): void {
    const rooms = loadRecentRooms()
    empty(this.tabsEl)
    for (const item of rooms) {
      const current = Boolean(active && item.name === normalizeRoomName(active.name) && item.strategy === active.strategy)
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
          this.openJump({ name: item.name, strategy: item.strategy, needPassword: true })
          return
        }
        this.go(resolved)
      })
      this.tabsEl.append(tab)
    }
    const add = el('button', { class: 'tab add', type: 'button', title: copy.addRoom }, ['+'])
    add.addEventListener('click', () => this.openJump())
    this.tabsEl.append(add)
  }

  private refreshTools(spec: RoomSpec | null): void {
    empty(this.toolsEl)
    this.toolsEl.append(this.themeBtn)
    if (!spec) return
    const share = el('button', { class: 'btn ghost', type: 'button' }, [copy.share])
    share.addEventListener('click', () => void this.shareRoom(spec, false, share))
    this.toolsEl.append(share)
    if (spec.password) {
      const shareKey = el('button', { class: 'btn ghost', type: 'button' }, [copy.shareWithKey])
      shareKey.addEventListener('click', () => void this.shareRoom(spec, true, shareKey))
      this.toolsEl.append(shareKey)
    }
    const leave = el('a', { class: 'btn ghost', href: '#/' }, [copy.leave])
    this.toolsEl.append(leave)
  }

  private async shareRoom(spec: RoomSpec, includePassword: boolean, button?: HTMLButtonElement): Promise<void> {
    const url = roomUrl(location.origin, location.pathname, spec, includePassword)
    const result = await shareOrCopy(url)
    if (!button) return
    const original = button.textContent
    button.textContent = result === 'shared' ? copy.shared : result === 'copied' ? copy.copied : copy.copyFailed
    window.setTimeout(() => {
      if (original) button.textContent = original
    }, 1400)
  }
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', {}, [label]), control])
}
