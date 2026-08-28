import { APP_ID, HELLO_INTERVAL_MS, RELAY_POLL_MS, TYPING_THROTTLE_MS, TYPING_TTL_MS } from '../config/app'
import { trimLines } from './cache'
import { randomHex } from './identity'
import {
  createChatPayload,
  createHelloPayload,
  createTypingPayload,
  parsePayload,
} from './protocol'
import { normalizeRoomName, roomNamespace } from './room'
import { rafBatch, throttle } from './scheduler'
import { TrysteroTransport } from './transports/trystero'
import type { SignallingTransport } from './transports/types'
import type { ChatLine, Identity, Member, RoomSpec, SessionStatus } from './types'

export type SessionListener = {
  onStatus?: (status: SessionStatus) => void
  onMembers?: (members: Member[]) => void
  onLine?: (line: ChatLine) => void
  onReset?: (lines: ChatLine[]) => void
}

export class ChatSession {
  private transport: SignallingTransport
  private identity: Identity
  private members = new Map<string, Member>()
  private lines: ChatLine[] = []
  private seen = new Set<string>()
  private listeners: SessionListener
  private helloTimer: number | null = null
  private relayTimer: number | null = null
  private typingTimers = new Map<string, number>()
  private paused = false
  private joined = false
  private status: SessionStatus = {
    phase: 'idle',
    detail: '尚未连接',
    relays: [],
    peerCount: 0,
  }

  private readonly emitMembers = rafBatch(() => {
    this.listeners.onMembers?.([...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt))
  })

  private readonly sendTypingThrottled = throttle(() => {
    void this.transport.send(createTypingPayload(this.identity.nick))
  }, TYPING_THROTTLE_MS)

  constructor(identity: Identity, listeners: SessionListener, transport?: SignallingTransport) {
    this.identity = identity
    this.listeners = listeners
    this.transport = transport ?? new TrysteroTransport('torrent')
  }

  get selfId(): string {
    return this.transport.selfId() || this.identity.id
  }

  getLines(): ChatLine[] {
    return this.lines
  }

  hydrate(lines: ChatLine[]): void {
    this.lines = trimLines(lines)
    for (const line of this.lines) {
      if (line.kind === 'chat') this.seen.add(line.id)
    }
    this.listeners.onReset?.(this.lines)
  }

  async join(spec: RoomSpec): Promise<void> {
    if (this.joined) await this.leave({ silent: true })
    this.transport = new TrysteroTransport(spec.strategy)
    this.joined = true
    this.setStatus({
      phase: 'connecting',
      detail: spec.strategy === 'torrent' ? '正在连接 Tracker…' : '正在连接 Nostr…',
      relays: [],
      peerCount: 0,
    })

    await this.transport.join(
      {
        appId: APP_ID,
        roomId: roomNamespace({ name: normalizeRoomName(spec.name), password: spec.password }),
        password: spec.password,
        strategy: spec.strategy,
      },
      {
        onPeerJoin: (peerId) => {
          this.upsertMember(peerId, '访客')
          this.pushSystem(`${peerId.slice(0, 6)} 加入了房间`)
          void this.transport.send(createHelloPayload(this.identity.nick), peerId)
          void this.measure(peerId)
          this.emitMembers()
          this.refreshStatus('connected', `直连 ${this.transport.peerIds().length}`)
        },
        onPeerLeave: (peerId) => {
          const member = this.members.get(peerId)
          this.members.delete(peerId)
          this.pushSystem(`${member?.nick ?? peerId.slice(0, 6)} 离开了房间`)
          this.emitMembers()
          const n = this.transport.peerIds().length
          this.refreshStatus(n > 0 ? 'connected' : 'connecting', n > 0 ? `直连 ${n}` : '等待同伴')
        },
        onPayload: (peerId, payload) => this.handlePayload(peerId, payload),
        onJoinError: (detail) => {
          this.refreshStatus('connecting', `握手受阻：${detail}`)
        },
      },
    )

    this.bindVisibility()
    this.startTimers()
    this.refreshStatus('connecting', '已宣布，等待对等节点')
  }

  async sendChat(text: string): Promise<void> {
    const payload = createChatPayload(this.identity.nick, text, randomHex(8), Date.now())
    if (!payload.text) return
    this.seen.add(payload.id)
    this.pushLine({
      kind: 'chat',
      id: payload.id,
      fromId: this.selfId,
      nick: this.identity.nick,
      text: payload.text,
      ts: payload.ts,
      self: true,
    })
    await this.transport.send(payload)
  }

  sendTyping(): void {
    this.sendTypingThrottled()
  }

  setNick(nick: string): void {
    this.identity = { ...this.identity, nick }
    void this.transport.send(createHelloPayload(nick))
  }

  async leave(options: { silent?: boolean } = {}): Promise<void> {
    this.joined = false
    this.unbindVisibility()
    this.stopTimers()
    for (const timer of this.typingTimers.values()) window.clearTimeout(timer)
    this.typingTimers.clear()
    await this.transport.leave()
    this.members.clear()
    this.lines = []
    this.seen.clear()
    if (!options.silent) {
      this.setStatus({ phase: 'idle', detail: '已离开房间', relays: [], peerCount: 0 })
      this.emitMembers()
      this.listeners.onReset?.([])
    }
  }

  private handlePayload(peerId: string, raw: unknown): void {
    const payload = parsePayload(raw)
    if (!payload) return
    this.upsertMember(peerId, payload.nick)

    if (payload.type === 'hello') {
      this.emitMembers()
      return
    }

    if (payload.type === 'typing') {
      this.setTyping(peerId)
      this.emitMembers()
      return
    }

    if (this.seen.has(payload.id)) return
    this.seen.add(payload.id)
    this.pushLine({
      kind: 'chat',
      id: payload.id,
      fromId: peerId,
      nick: payload.nick,
      text: payload.text,
      ts: payload.ts,
      self: false,
    })
    this.emitMembers()
  }

  private upsertMember(id: string, nick: string): void {
    const existing = this.members.get(id)
    const now = Date.now()
    this.members.set(id, {
      id,
      nick,
      joinedAt: existing?.joinedAt ?? now,
      lastSeenAt: now,
      rttMs: existing?.rttMs ?? null,
      typing: existing?.typing ?? false,
    })
  }

  private setTyping(peerId: string): void {
    const member = this.members.get(peerId)
    if (!member) return
    member.typing = true
    const previous = this.typingTimers.get(peerId)
    if (previous) window.clearTimeout(previous)
    this.typingTimers.set(
      peerId,
      window.setTimeout(() => {
        const current = this.members.get(peerId)
        if (current) {
          current.typing = false
          this.emitMembers()
        }
      }, TYPING_TTL_MS),
    )
  }

  private async measure(peerId: string): Promise<void> {
    try {
      const rtt = await this.transport.ping(peerId)
      const member = this.members.get(peerId)
      if (member) {
        member.rttMs = rtt
        this.emitMembers()
      }
    } catch {
      // Ping can fail during ICE restart; presence still stands.
    }
  }

  private pushSystem(text: string): void {
    this.pushLine({ kind: 'system', id: randomHex(6), text, ts: Date.now() })
  }

  private pushLine(line: ChatLine): void {
    this.lines.push(line)
    this.lines = trimLines(this.lines)
    this.listeners.onLine?.(line)
  }

  private refreshStatus(phase: SessionStatus['phase'], detail: string): void {
    this.setStatus({
      phase,
      detail,
      relays: this.transport.relays(),
      peerCount: this.transport.peerIds().length,
    })
  }

  private setStatus(status: SessionStatus): void {
    this.status = status
    this.listeners.onStatus?.(status)
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stopTimers()
    else if (this.joined) this.startTimers()
  }

  private bindVisibility(): void {
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private unbindVisibility(): void {
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private startTimers(): void {
    this.stopTimers()
    this.helloTimer = window.setInterval(() => {
      if (!this.paused) void this.transport.send(createHelloPayload(this.identity.nick))
    }, HELLO_INTERVAL_MS)
    this.relayTimer = window.setInterval(() => {
      this.refreshStatus(this.status.phase, this.status.detail)
    }, RELAY_POLL_MS)
  }

  private stopTimers(): void {
    if (this.helloTimer !== null) {
      window.clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.relayTimer !== null) {
      window.clearInterval(this.relayTimer)
      this.relayTimer = null
    }
    this.paused = document.hidden
  }
}
