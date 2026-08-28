import { DEFAULT_ROOM, SOURCE_URL } from '../config/app'
import { colorFromId, loadIdentity, persistNick } from '../core/identity'
import { loadRecentRooms, type RecentRoom } from '../core/recent'
import { normalizeRoomName, sameRoom } from '../core/room'
import { RoomManager } from '../core/room-manager'
import { parseHash, toHash } from '../core/router'
import type { Member, RoomSpec, SessionStatus, SignalStrategy, ThemePreference } from '../core/types'
import { copy } from './copy'
import { el, empty, hostOf, wsLabel } from './dom'
import { LogView } from './log-view'
import { StampPicker } from './picker'
import { applyTheme, cycleTheme, loadThemePreference, persistThemePreference } from './theme'

function webrtcReady(): boolean {
  return typeof RTCPeerConnection === 'function'
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
  private chat: ChatPane | null = null
  private lobbyEl: HTMLElement | null = null
  private routing = false

  constructor(root: HTMLElement) {
    this.root = root
    this.theme = loadThemePreference()
    applyTheme(this.theme)
    this.themeBtn = el('button', { class: 'btn ghost', type: 'button', title: '主题' }, [themeIcon(this.theme)])
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
    this.footerEl = el('p', { class: 'footer' }, [
      el('a', { href: SOURCE_URL, target: '_blank', rel: 'noreferrer' }, [copy.source]),
      ' · AGPL-3.0',
    ])
    this.manager = new RoomManager(this.identity, {
      onStatus: (status) => this.chat?.status(status),
      onMembers: (members) => this.chat?.members(members, this.manager.getSession()?.selfId ?? this.identity.id),
      onLine: (line) => this.chat?.log.append(line),
      onReset: (lines) => this.chat?.log.reset(lines),
    })
  }

  start(): void {
    this.mount()
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(this.theme))
    window.addEventListener('hashchange', () => {
      if (!this.routing) void this.route()
    })
    window.addEventListener('pagehide', () => {
      void this.manager.close()
    })
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        this.jump.showModal()
        this.jumpRoom.focus()
      }
      if (event.key === 'Escape') this.jump.close()
    })
    this.themeBtn.addEventListener('click', () => {
      this.theme = cycleTheme(this.theme)
      persistThemePreference(this.theme)
      applyTheme(this.theme)
      this.themeBtn.textContent = themeIcon(this.theme)
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
          ]),
          this.tabsEl,
          this.toolsEl,
        ]),
        this.capabilityBanner(),
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
        el('button', { class: 'btn ghost', type: 'button', value: 'cancel' }, ['取消']),
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

  private async route(): Promise<void> {
    const route = parseHash(location.hash)
    this.refreshTabs()
    this.refreshTools(route.name === 'room' ? route.spec : null)
    if (route.name === 'lobby') {
      await this.manager.close()
      this.showLobby()
      return
    }
    await this.showChat(route.spec)
  }

  private go(spec: RoomSpec): void {
    const next = toHash({ name: 'room', spec }, Boolean(spec.password))
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
    const current = this.manager.current()
    if (!this.chat) {
      this.chat = new ChatPane({
        selfId: this.identity.id,
        send: (text) => void this.manager.getSession()?.sendChat(text),
        typing: () => this.manager.getSession()?.sendTyping(),
      })
    }
    this.lobbyEl = null
    this.footerEl.hidden = true
    this.root.classList.add('mode-chat')
    this.main.replaceChildren(this.chat.root)
    this.chat.show()
    this.refreshTabs(spec)
    this.refreshTools(spec)
    if (current && sameRoom(current, spec)) return
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
    const form = el('form', { class: 'panel form lobby-form' }, [
      el('div', { class: 'join-row' }, [
        field(copy.nick, nick),
        field(copy.room, room),
        el('button', { class: 'btn primary join-btn', type: 'submit' }, [copy.join]),
      ]),
      el('details', { class: 'more' }, [
        el('summary', {}, [copy.more]),
        el('div', { class: 'row' }, [
          field(copy.password, password),
          field(copy.strategy, strategy),
        ]),
        el('span', { class: 'hint' }, [copy.passwordHint]),
      ]),
    ])
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.identity = { ...this.identity, nick: persistNick(nick.value) }
      this.manager.setIdentity(this.identity)
      this.go({
        name: room.value,
        password: password.value,
        strategy: strategy.value as SignalStrategy,
      })
    })
    return form
  }

  private refreshTabs(active?: RoomSpec): void {
    const rooms = loadRecentRooms()
    empty(this.tabsEl)
    for (const item of rooms) {
      const spec: RoomSpec = { name: item.name, password: '', strategy: item.strategy }
      const current = Boolean(active && item.name === normalizeRoomName(active.name) && item.strategy === active.strategy)
      const tab = el('a', { class: `tab${current ? ' on' : ''}`, href: toHash({ name: 'room', spec }) }, [item.name])
      tab.addEventListener('click', (event) => {
        event.preventDefault()
        this.go(specFromRecent(item, active))
      })
      this.tabsEl.append(tab)
    }
    const add = el('button', { class: 'tab add', type: 'button', title: copy.addRoom }, ['+'])
    add.addEventListener('click', () => {
      this.jump.showModal()
      this.jumpRoom.focus()
    })
    this.tabsEl.append(add)
  }

  private refreshTools(spec: RoomSpec | null): void {
    empty(this.toolsEl)
    this.toolsEl.append(this.themeBtn)
    if (!spec) return
    const share = el('button', { class: 'btn ghost', type: 'button' }, [copy.share])
    share.addEventListener('click', async () => {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${toHash({ name: 'room', spec })}`)
      share.textContent = copy.copied
      window.setTimeout(() => {
        share.textContent = copy.share
      }, 1000)
    })
    this.toolsEl.append(share)
    if (spec.password) {
      const shareKey = el('button', { class: 'btn ghost', type: 'button' }, [copy.shareWithKey])
      shareKey.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${location.origin}${location.pathname}${toHash({ name: 'room', spec }, true)}`)
        shareKey.textContent = copy.copied
      })
      this.toolsEl.append(shareKey)
    }
    const leave = el('a', { class: 'btn ghost', href: '#/' }, [copy.leave])
    this.toolsEl.append(leave)
  }
}

class ChatPane {
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

function field(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, [el('span', {}, [label]), control])
}

function themeIcon(pref: ThemePreference): string {
  if (pref === 'light') return '浅色'
  if (pref === 'dark') return '深色'
  return '自动'
}

function specFromRecent(item: RecentRoom, active?: RoomSpec): RoomSpec {
  const password = active && item.name === normalizeRoomName(active.name) && item.strategy === active.strategy ? active.password : ''
  return { name: item.name, password, strategy: item.strategy }
}
