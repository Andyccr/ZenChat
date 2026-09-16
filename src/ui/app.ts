import { SOURCE_URL } from '../config/app'
import { loadIdentity, persistNick } from '../core/identity'
import { RoomManager } from '../core/room-manager'
import { parseHash, toHash } from '../core/router'
import { rememberSecret, withSecret } from '../core/secrets'
import { watchDuplicateTab } from '../core/tab-guard'
import type { RoomSpec, ThemePreference } from '../core/types'
import { capabilityBanner } from './capability'
import { ChatPane } from './chat-pane'
import { copy } from './copy'
import { el } from './dom'
import { createJumpDialog, type JumpDialog } from './jump-dialog'
import { buildLobby } from './lobby'
import { flashShare, renderTabs, renderTools } from './room-chrome'
import { applyTheme, cycleTheme, loadThemePreference, persistThemePreference, themeLabel } from './theme'

export class App {
  private root: HTMLElement
  private theme: ThemePreference
  private identity = loadIdentity()
  private manager: RoomManager
  private themeBtn: HTMLButtonElement
  private tabsEl: HTMLElement
  private toolsEl: HTMLElement
  private main: HTMLElement
  private jump: JumpDialog
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
    this.jump = createJumpDialog((spec) => this.go(spec))
    this.dupBanner = el('div', { class: 'banner warn hidden' }, [copy.duplicateTab])
    this.footerEl = el('p', { class: 'footer' }, [
      el('a', { href: SOURCE_URL, target: '_blank', rel: 'noreferrer' }, [copy.source]),
      ' · AGPL-3.0',
    ])
    this.manager = new RoomManager(this.identity, {
      onStatus: (status) => this.chat?.status(status),
      onMembers: (members) => this.chat?.members(members, this.manager.selfId()),
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
        this.jump.open()
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
        capabilityBanner(),
        this.dupBanner,
        this.main,
        this.footerEl,
      ]),
      this.jump.el,
    )
  }

  private async route(): Promise<void> {
    const route = parseHash(location.hash)
    this.refreshChrome(route.name === 'room' ? withSecret(route.spec) : undefined)
    if (route.name === 'lobby') {
      await this.manager.close()
      this.showLobby()
      return
    }
    await this.showChat(this.stripPasswordFromHash(withSecret(route.spec)))
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
    const next = buildLobby({
      nick: this.identity.nick,
      onJoin: ({ nick, spec }) => {
        this.identity = { ...this.identity, nick: persistNick(nick) }
        this.manager.setIdentity(this.identity)
        this.go(spec)
      },
    })
    if (this.lobbyEl) this.lobbyEl.replaceWith(next)
    this.lobbyEl = next
    this.main.replaceChildren(this.lobbyEl)
    this.refreshChrome()
  }

  private async showChat(spec: RoomSpec): Promise<void> {
    if (!this.chat) {
      this.chat = new ChatPane({
        selfId: this.identity.id,
        nick: this.identity.nick,
        send: (text) => this.manager.sendChat(text),
        typing: () => this.manager.sendTyping(),
        onRetry: () => void this.manager.retry(),
        onShare: () => {
          const current = this.manager.current() ?? spec
          void flashShare(current, false)
        },
        onSwitchSignal: () => {
          const current = this.manager.current() ?? spec
          this.go({ ...current, strategy: current.strategy === 'torrent' ? 'nostr' : 'torrent' })
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
    this.refreshChrome(spec)
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

  private refreshChrome(spec?: RoomSpec): void {
    renderTabs(this.tabsEl, spec, {
      onGo: (next) => this.go(next),
      onNeedPassword: (item) => this.jump.open({ name: item.name, strategy: item.strategy, needPassword: true }),
      onAdd: () => this.jump.open(),
    })
    renderTools(this.toolsEl, this.themeBtn, spec ?? null, (room, withKey, button) => {
      void flashShare(room, withKey, button)
    })
  }
}
