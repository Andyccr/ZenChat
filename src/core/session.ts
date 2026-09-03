import { APP_ID, HELLO_INTERVAL_MS, RELAY_POLL_MS, TYPING_THROTTLE_MS } from '../config/app'
import { randomHex } from './identity'
import { Presence } from './presence'
import {
  createChatPayload,
  createHelloPayload,
  createTypingPayload,
  parsePayload,
} from './protocol'
import { normalizeRoomName, roomNamespace } from './room'
import { browserRuntime, type Runtime } from './runtime'
import { rafBatch, throttle } from './scheduler'
import { chatLine, systemLine, Transcript } from './transcript'
import { createTransport, type TransportFactory } from './transports/create'
import type { SignallingTransport } from './transports/types'
import type { ChatLine, Identity, Member, RoomSpec, SessionStatus } from './types'

export type SessionListener = {
  onStatus?: (status: SessionStatus) => void
  onMembers?: (members: Member[]) => void
  onLine?: (line: ChatLine) => void
  onReset?: (lines: ChatLine[]) => void
}

export type SessionOptions = {
  createTransport?: TransportFactory
  runtime?: Runtime
}

export class ChatSession {
  private transport: SignallingTransport
  private identity: Identity
  private listeners: SessionListener
  private createTransport: TransportFactory
  private runtime: Runtime
  private transcript = new Transcript()
  private presence: Presence
  private helloTimer: number | null = null
  private relayTimer: number | null = null
  private unbindVisibility: (() => void) | null = null
  private joined = false
  private status: SessionStatus = {
    phase: 'idle',
    detail: '尚未连接',
    relays: [],
    peerCount: 0,
  }

  private readonly emitMembers = rafBatch(() => {
    this.listeners.onMembers?.(this.presence.list())
  })

  private readonly sendTypingThrottled = throttle(() => {
    if (!this.joined) return
    void this.transport.send(createTypingPayload(this.identity.nick))
  }, TYPING_THROTTLE_MS)

  constructor(identity: Identity, listeners: SessionListener, options: SessionOptions = {}) {
    this.identity = identity
    this.listeners = listeners
    this.createTransport = options.createTransport ?? createTransport
    this.runtime = options.runtime ?? browserRuntime
    this.transport = this.createTransport('torrent')
    this.presence = new Presence(this.runtime, () => this.emitMembers())
  }

  get selfId(): string {
    return this.transport.selfId() || this.identity.id
  }

  isJoined(): boolean {
    return this.joined
  }

  getLines(): ChatLine[] {
    return this.transcript.snapshot()
  }

  hydrate(lines: ChatLine[]): void {
    this.listeners.onReset?.(this.transcript.hydrate(lines))
  }

  async join(spec: RoomSpec): Promise<void> {
    if (this.joined) await this.leave({ silent: true })
    this.transport = this.createTransport(spec.strategy)
    this.joined = true
    this.setStatus({
      phase: 'connecting',
      detail: spec.strategy === 'torrent' ? '正在连接 Tracker…' : '正在连接 Nostr…',
      relays: [],
      peerCount: 0,
    })

    try {
      await this.transport.join(
        {
          appId: APP_ID,
          roomId: roomNamespace({ name: normalizeRoomName(spec.name), password: spec.password }),
          password: spec.password,
          strategy: spec.strategy,
        },
        {
          onPeerJoin: (peerId) => {
            this.presence.upsert(peerId, '访客')
            this.pushSystem(`${peerId.slice(0, 6)} 加入了房间`)
            void this.transport.send(createHelloPayload(this.identity.nick), peerId)
            this.emitMembers()
            this.refreshStatus('connected', `直连 ${this.transport.peerIds().length}`)
            this.runtime.setTimeout(() => void this.measure(peerId), 350)
          },
          onPeerLeave: (peerId) => {
            const member = this.presence.remove(peerId)
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
    } catch (error) {
      this.joined = false
      const detail = error instanceof Error ? error.message : '连接失败'
      this.refreshStatus('error', `无法启动 P2P：${detail}`)
      throw error
    }

    this.bindVisibility()
    this.startTimers()
    this.refreshStatus('connecting', '已宣布，等待对等节点')
  }

  async sendChat(text: string): Promise<void> {
    if (!this.joined) return
    const payload = createChatPayload(this.identity.nick, text, randomHex(8), this.runtime.now())
    if (!payload.text) return
    this.pushLine(
      chatLine({
        id: payload.id,
        fromId: this.selfId,
        nick: this.identity.nick,
        text: payload.text,
        ts: payload.ts,
        self: true,
      }),
    )
    void this.transport.send(payload)
  }

  sendTyping(): void {
    this.sendTypingThrottled()
  }

  setNick(nick: string): void {
    this.identity = { ...this.identity, nick }
    if (this.joined) void this.transport.send(createHelloPayload(nick))
  }

  async leave(options: { silent?: boolean } = {}): Promise<void> {
    this.joined = false
    this.unbindVisibility?.()
    this.unbindVisibility = null
    this.stopTimers()
    this.presence.clear()
    await this.transport.leave()
    this.transcript.clear()
    if (!options.silent) {
      this.setStatus({ phase: 'idle', detail: '已离开房间', relays: [], peerCount: 0 })
      this.emitMembers()
      this.listeners.onReset?.([])
    }
  }

  private handlePayload(peerId: string, raw: unknown): void {
    const payload = parsePayload(raw)
    if (!payload) return
    this.presence.upsert(peerId, payload.nick)

    if (payload.type === 'hello') {
      this.emitMembers()
      return
    }

    if (payload.type === 'typing') {
      this.presence.markTyping(peerId)
      this.emitMembers()
      return
    }

    if (this.transcript.has(payload.id)) return
    this.pushLine(
      chatLine({
        id: payload.id,
        fromId: peerId,
        nick: payload.nick,
        text: payload.text,
        ts: payload.ts,
        self: false,
      }),
    )
    this.emitMembers()
  }

  private async measure(peerId: string): Promise<void> {
    if (!this.joined) return
    try {
      const rtt = await this.transport.ping(peerId)
      if (this.joined && this.presence.setRtt(peerId, rtt)) this.emitMembers()
    } catch {
      // Ping can fail during ICE restart; presence still stands.
    }
  }

  private pushSystem(text: string): void {
    this.pushLine(systemLine(randomHex(6), text, this.runtime.now()))
  }

  private pushLine(line: ChatLine): void {
    const accepted = this.transcript.append(line)
    if (accepted) this.listeners.onLine?.(accepted)
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
    const prev = this.status
    if (
      prev.phase === status.phase &&
      prev.detail === status.detail &&
      prev.peerCount === status.peerCount &&
      prev.relays.length === status.relays.length &&
      prev.relays.every((relay, i) => relay.readyState === status.relays[i]?.readyState)
    ) {
      return
    }
    this.status = status
    this.listeners.onStatus?.(status)
  }

  private onVisibility = (): void => {
    if (this.runtime.hidden()) this.stopTimers()
    else if (this.joined) this.startTimers()
  }

  private bindVisibility(): void {
    this.unbindVisibility?.()
    this.unbindVisibility = this.runtime.onVisibilityChange(this.onVisibility)
  }

  private startTimers(): void {
    this.stopTimers()
    this.helloTimer = this.runtime.setInterval(() => {
      void this.transport.send(createHelloPayload(this.identity.nick))
    }, HELLO_INTERVAL_MS)
    this.relayTimer = this.runtime.setInterval(() => {
      this.refreshStatus(this.status.phase, this.status.detail)
    }, RELAY_POLL_MS)
  }

  private stopTimers(): void {
    if (this.helloTimer !== null) {
      this.runtime.clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.relayTimer !== null) {
      this.runtime.clearInterval(this.relayTimer)
      this.relayTimer = null
    }
  }
}
