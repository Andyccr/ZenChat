import { DEFAULT_ROOM, SOURCE_URL } from '../config/app'
import { colorFromId, loadIdentity, persistNick } from '../core/identity'
import { loadRecentRooms, rememberRoom } from '../core/recent'
import { parseHash, toHash } from '../core/router'
import { ChatSession } from '../core/session'
import type { ChatLine, Member, RoomSpec, SessionStatus, SignalStrategy, ThemePreference } from '../core/types'
import { copy } from './copy'
import { el, empty, formatTime, hostOf, wsLabel } from './dom'
import { applyTheme, cycleTheme, loadThemePreference, persistThemePreference, themeLabel } from './theme'

function webrtcReady(): boolean {
  return typeof RTCPeerConnection === 'function'
}

function secureContext(): boolean {
  return window.isSecureContext
}

export class App {
  private root: HTMLElement
  private theme: ThemePreference
  private identity = loadIdentity()
  private session: ChatSession | null = null
  private media: MediaQueryList | null = null

  constructor(root: HTMLElement) {
    this.root = root
    this.theme = loadThemePreference()
    applyTheme(this.theme)
  }

  start(): void {
    this.media = window.matchMedia('(prefers-color-scheme: dark)')
    this.media.addEventListener('change', () => applyTheme(this.theme))
    window.addEventListener('hashchange', () => void this.render())
    window.addEventListener('pagehide', () => {
      void this.session?.leave()
    })
    void this.render()
  }

  private async render(): Promise<void> {
    empty(this.root)
    const route = parseHash(location.hash)
    const shell = el('div', { class: 'shell' }, [
      this.topbar(route.name === 'room' ? route.spec : null),
    ])

    if (!secureContext()) {
      shell.append(el('div', { class: 'banner' }, [copy.insecure]))
    } else if (!webrtcReady()) {
      shell.append(el('div', { class: 'banner' }, [copy.webrtcMissing]))
    }

    if (route.name === 'lobby') {
      await this.session?.leave()
      this.session = null
      shell.append(this.lobby())
    } else {
      shell.append(await this.chat(route.spec))
    }

    shell.append(
      el('p', { class: 'footer' }, [
        el('a', { href: SOURCE_URL, target: '_blank', rel: 'noreferrer' }, [copy.source]),
        ' · AGPL-3.0 · 消息只经过浏览器之间的 DataChannel',
      ]),
    )
    this.root.append(shell)
  }

  private topbar(spec: RoomSpec | null): HTMLElement {
    const themeBtn = el('button', { class: 'btn', type: 'button' }, [`主题：${themeLabel(this.theme)}`])
    themeBtn.addEventListener('click', () => {
      this.theme = cycleTheme(this.theme)
      persistThemePreference(this.theme)
      applyTheme(this.theme)
      themeBtn.textContent = `主题：${themeLabel(this.theme)}`
    })

    const tools: HTMLElement[] = [themeBtn]
    if (spec) {
      const share = el('button', { class: 'btn', type: 'button' }, [copy.share])
      share.addEventListener('click', async () => {
        await navigator.clipboard.writeText(`${location.origin}${location.pathname}${toHash({ name: 'room', spec })}`)
        share.textContent = copy.copied
        window.setTimeout(() => {
          share.textContent = copy.share
        }, 1200)
      })
      tools.push(share)
      if (spec.password) {
        const shareKey = el('button', { class: 'btn', type: 'button' }, [copy.shareWithKey])
        shareKey.addEventListener('click', async () => {
          await navigator.clipboard.writeText(
            `${location.origin}${location.pathname}${toHash({ name: 'room', spec }, true)}`,
          )
          shareKey.textContent = copy.copied
        })
        tools.push(shareKey)
      }
      const leave = el('button', { class: 'btn', type: 'button' }, [copy.leave])
      leave.addEventListener('click', () => {
        location.hash = '#/'
      })
      tools.push(leave)
    }

    return el('header', { class: 'topbar' }, [
      el('a', { class: 'brand', href: '#/' }, [
        el('div', { class: 'enso', 'aria-hidden': 'true' }),
        el('strong', {}, [copy.title]),
        el('span', {}, [copy.tagline]),
      ]),
      el('div', { class: 'toolbar' }, tools),
    ])
  }

  private lobby(): HTMLElement {
    const nick = el('input', {
      id: 'nick',
      maxlength: 24,
      value: this.identity.nick,
      autocomplete: 'nickname',
    }) as HTMLInputElement
    const room = el('input', {
      id: 'room',
      maxlength: 64,
      value: DEFAULT_ROOM,
      autocomplete: 'off',
    }) as HTMLInputElement
    const password = el('input', {
      id: 'password',
      type: 'password',
      autocomplete: 'off',
    }) as HTMLInputElement
    const strategy = el('select', { id: 'strategy' }, [
      el('option', { value: 'torrent', selected: true }, [copy.torrent]),
      el('option', { value: 'nostr' }, [copy.nostr]),
    ]) as HTMLSelectElement

    const form = el('form', { class: 'panel grid' }, [
      el('p', { class: 'lede' }, [copy.lobbyHint]),
      el('label', { class: 'field' }, [el('span', {}, [copy.nick]), nick]),
      el('label', { class: 'field' }, [el('span', {}, [copy.room]), room]),
      el('label', { class: 'field' }, [el('span', {}, [copy.password]), password, el('span', { class: 'hint' }, [copy.passwordHint])]),
      el('label', { class: 'field' }, [el('span', {}, [copy.strategy]), strategy]),
      el('div', { class: 'actions' }, [el('button', { class: 'btn primary', type: 'submit' }, [copy.join])]),
    ])

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.identity = { ...this.identity, nick: persistNick(nick.value) }
      const spec: RoomSpec = {
        name: room.value,
        password: password.value,
        strategy: strategy.value as SignalStrategy,
      }
      location.hash = toHash({ name: 'room', spec }, Boolean(spec.password))
    })

    const recent = loadRecentRooms()
    const recentBlock = el('section', { class: 'recent' }, [
      el('h2', {}, [copy.recent]),
      recent.length === 0
        ? el('p', { class: 'muted' }, [copy.emptyRecent])
        : el(
            'div',
            { class: 'chips' },
            recent.map((item) =>
              el(
                'a',
                {
                  class: 'chip',
                  href: toHash({
                    name: 'room',
                    spec: { name: item.name, password: '', strategy: item.strategy },
                  }),
                },
                [`${item.name} · ${item.strategy === 'torrent' ? 'Tracker' : 'Nostr'}`],
              ),
            ),
          ),
    ])

    return el('div', {}, [form, recentBlock])
  }

  private async chat(spec: RoomSpec): Promise<HTMLElement> {
    await this.session?.leave()
    rememberRoom(spec)

    const statusEl = el('div', { class: 'status' })
    const log = el('div', { class: 'log' })
    const membersEl = el('div')
    const composer = el('textarea', {
      rows: 3,
      placeholder: copy.placeholder,
      maxlength: 4000,
    }) as HTMLTextAreaElement
    const sendBtn = el('button', { class: 'btn primary', type: 'button' }, [copy.send])

    this.session = new ChatSession(this.identity, {
      onStatus: (status) => renderStatus(statusEl, status, spec),
      onMembers: (members) => renderMembers(membersEl, members, this.session?.selfId ?? this.identity.id),
      onMessages: (lines) => renderMessages(log, lines),
    })

    try {
      await this.session.join(spec)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '连接失败'
      statusEl.replaceChildren(el('span', {}, [`无法启动 P2P：${detail}`]))
    }

    const send = async () => {
      const text = composer.value
      composer.value = ''
      await this.session?.sendChat(text)
    }

    sendBtn.addEventListener('click', () => void send())
    composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void send()
      }
    })
    composer.addEventListener('input', () => {
      void this.session?.sendTyping()
    })

    return el('div', { class: 'chat' }, [
      el('section', { class: 'panel transcript' }, [
        statusEl,
        log,
        el('div', { class: 'composer' }, [composer, sendBtn]),
      ]),
      el('aside', { class: 'panel side' }, [
        el('h2', {}, [copy.members]),
        membersEl,
        el('p', { class: 'muted' }, [copy.waiting]),
      ]),
    ])
  }
}

function renderStatus(root: HTMLElement, status: SessionStatus, spec: RoomSpec): void {
  empty(root)
  const open = status.relays.filter((relay) => relay.readyState === WebSocket.OPEN).length
  root.append(
    el('span', {}, [
      el('i', { class: `dot${status.peerCount > 0 ? ' ok' : ''}` }),
      `  ${spec.name} · ${status.detail}`,
    ]),
    el('span', {}, [`节点 ${status.peerCount} · 信令 ${open}/${Math.max(status.relays.length, 1)}`]),
  )
  if (status.relays.length > 0) {
    root.title = status.relays.map((relay) => `${hostOf(relay.url)} ${wsLabel(relay.readyState)}`).join('\n')
  }
}

function renderMembers(root: HTMLElement, members: Member[], selfId: string): void {
  empty(root)
  root.append(
    el('div', { class: 'member' }, [
      el('b', { style: `color:${colorFromId(selfId)}` }, [`${copy.you}`]),
      el('span', { class: 'muted' }, [selfId.slice(0, 8)]),
    ]),
  )
  for (const member of members) {
    const extra = member.typing ? '正在输入…' : member.rttMs !== null ? `${Math.round(member.rttMs)} ms` : '已连接'
    root.append(
      el('div', { class: 'member' }, [
        el('b', { style: `color:${colorFromId(member.id)}` }, [member.nick]),
        el('span', { class: 'muted' }, [extra]),
      ]),
    )
  }
}

function renderMessages(root: HTMLElement, lines: ChatLine[]): void {
  empty(root)
  for (const line of lines) {
    if (line.kind === 'system') {
      root.append(el('div', { class: 'system' }, [line.text]))
      continue
    }
    root.append(
      el('article', { class: `bubble${line.self ? ' self' : ''}` }, [
        el('header', {}, [el('b', { style: `color:${colorFromId(line.fromId)}` }, [line.nick]), el('span', {}, [formatTime(line.ts)])]),
        el('p', {}, [line.text]),
      ]),
    )
  }
  root.scrollTop = root.scrollHeight
}
