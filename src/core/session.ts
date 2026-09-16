import { ACK_TIMEOUT_MS, APP_ID, HELLO_INTERVAL_MS, RELAY_POLL_MS, TYPING_THROTTLE_MS } from '../config/app'
import { randomHex } from './identity'
import { Outbound } from './outbound'
import { Presence } from './presence'
import {
  createAckPayload,
  createChatPayload,
  createHelloPayload,
  createTypingPayload,
  FEATURE_ACK,
  parsePayload,
} from './protocol'
import { normalizeRoomName, roomNamespace } from './room'
import { browserRuntime, type Runtime } from './runtime'
import { rafBatch, throttle } from './scheduler'
import { idleLife, isJoined, reduceLife, uiPhase, type Life } from './session-machine'
import {
  connectedDetail,
  connectingDetail,
  startFailedDetail,
  STATUS_COPY,
  waitingOrDown,
} from './status'
import { chatLine, systemLine, Transcript } from './transcript'
import { createTransport, type TransportFactory } from './transports/create'
import type { SignallingTransport } from './transports/types'
import type { ChatLine, Identity, Member, RoomSpec, SendResult, SessionStatus, SignalStrategy } from './types'

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
  private outbound: Outbound
  private life: Life = idleLife()
  private helloTimer: number | null = null
  private relayTimer: number | null = null
  private unbindVisibility: (() => void) | null = null
  private strategy: SignalStrategy = 'torrent'
  private joinErrors = 0
  private status: SessionStatus = {
    phase: 'idle',
    detail: STATUS_COPY.idle,
    relays: [],
    peerCount: 0,
  }

  private readonly emitMembers = rafBatch(() => {
    this.listeners.onMembers?.(this.presence.list())
  })

  private readonly sendTypingThrottled = throttle(() => {
    if (!this.isJoined()) return
    void this.transport.send(createTypingPayload(this.identity.nick))
  }, TYPING_THROTTLE_MS)

  constructor(identity: Identity, listeners: SessionListener, options: SessionOptions = {}) {
    this.identity = identity
    this.listeners = listeners
    this.createTransport = options.createTransport ?? createTransport
    this.runtime = options.runtime ?? browserRuntime
    this.transport = this.createTransport('torrent')
    this.presence = new Presence(this.runtime, () => this.emitMembers())
    this.outbound = new Outbound(this.runtime, ACK_TIMEOUT_MS, (id) => this.expireAck(id))
  }

  get selfId(): string {
    return this.transport.selfId() || this.identity.id
  }

  isJoined(): boolean {
    return isJoined(this.life)
  }

  getLines(): ChatLine[] {
    return this.transcript.snapshot()
  }

  hydrate(lines: ChatLine[]): void {
    this.listeners.onReset?.(this.transcript.hydrate(lines))
  }

  async join(spec: RoomSpec): Promise<void> {
    if (this.isJoined()) await this.leave({ silent: true })
    this.strategy = spec.strategy
    this.joinErrors = 0
    this.transport = this.createTransport(spec.strategy)
    this.life = reduceLife(this.life, { type: 'join' })
    this.setStatus({
      phase: 'connecting',
      detail: connectingDetail(spec.strategy),
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
            this.notePeers()
            this.runtime.setTimeout(() => void this.measure(peerId), 350)
          },
          onPeerLeave: (peerId) => {
            const member = this.presence.remove(peerId)
            this.pushSystem(`${member?.nick ?? peerId.slice(0, 6)} 离开了房间`)
            this.emitMembers()
            this.notePeers()
          },
          onPayload: (peerId, payload) => this.handlePayload(peerId, payload),
          onJoinError: () => {
            this.joinErrors += 1
            if (this.transport.peerIds().length > 0) return
            if (this.joinErrors >= 3) {
              this.life = reduceLife(this.life, { type: 'force_down' })
              this.emitStatus()
            } else this.refreshStatus('connecting', STATUS_COPY.handshake)
          },
        },
      )
    } catch (error) {
      this.life = reduceLife(this.life, { type: 'join_err' })
      const detail = error instanceof Error ? error.message : '连接失败'
      this.refreshStatus('error', startFailedDetail(detail))
      throw error
    }

    this.life = reduceLife(this.life, { type: 'join_ok' })
    this.bindVisibility()
    this.startTimers()
    void this.transport.send(createHelloPayload(this.identity.nick))
    this.emitStatus()
  }

  async sendChat(text: string): Promise<SendResult> {
    if (!this.isJoined()) return 'closed'
    const payload = createChatPayload(this.identity.nick, text, randomHex(8), this.runtime.now())
    if (!payload.text) return 'empty'
    const expectAck = this.presence.supports(FEATURE_ACK)
    this.pushLine(
      chatLine({
        id: payload.id,
        fromId: this.selfId,
        nick: this.identity.nick,
        text: payload.text,
        ts: payload.ts,
        self: true,
        ...(expectAck ? { delivery: 'pending' as const } : {}),
      }),
    )
    try {
      await this.transport.send(payload)
    } catch {
      this.patchDelivery(payload.id, 'failed')
      this.pushSystem(STATUS_COPY.sendFailed)
      return 'failed'
    }
    if (expectAck) this.outbound.expect(payload.id)
    return 'sent'
  }

  sendTyping(): void {
    this.sendTypingThrottled()
  }

  setNick(nick: string): void {
    this.identity = { ...this.identity, nick }
    if (this.isJoined()) void this.transport.send(createHelloPayload(nick))
  }

  async leave(options: { silent?: boolean } = {}): Promise<void> {
    this.life = reduceLife(this.life, { type: 'leave' })
    this.unbindVisibility?.()
    this.unbindVisibility = null
    this.stopTimers()
    this.outbound.clear()
    this.presence.clear()
    await this.transport.leave()
    this.transcript.clear()
    this.life = reduceLife(this.life, { type: 'left' })
    if (!options.silent) {
      this.setStatus({ phase: 'idle', detail: STATUS_COPY.left, relays: [], peerCount: 0 })
      this.emitMembers()
      this.listeners.onReset?.([])
    }
  }

  private handlePayload(peerId: string, raw: unknown): void {
    const payload = parsePayload(raw)
    if (!payload) return
    if (payload.type === 'hello') this.presence.upsert(peerId, payload.nick, payload.features)
    else this.presence.upsert(peerId, payload.nick)

    if (payload.type === 'hello') {
      this.emitMembers()
      return
    }

    if (payload.type === 'typing') {
      this.presence.markTyping(peerId)
      this.emitMembers()
      return
    }

    if (payload.type === 'ack') {
      if (this.outbound.ack(payload.id)) this.patchDelivery(payload.id, 'acked')
      return
    }

    if (this.transcript.has(payload.id)) {
      void this.transport.send(createAckPayload(this.identity.nick, payload.id), peerId)
      return
    }
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
    void this.transport.send(createAckPayload(this.identity.nick, payload.id), peerId)
    this.emitMembers()
  }

  private expireAck(id: string): void {
    if (!this.isJoined()) return
    this.patchDelivery(id, 'failed')
  }

  private patchDelivery(id: string, delivery: 'acked' | 'failed' | 'pending'): void {
    const next = this.transcript.patchDelivery(id, delivery)
    if (next) this.listeners.onLine?.(next)
  }

  private async measure(peerId: string): Promise<void> {
    if (!this.isJoined()) return
    try {
      const rtt = await this.transport.ping(peerId)
      if (this.isJoined() && this.presence.setRtt(peerId, rtt)) this.emitMembers()
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

  private notePeers(): void {
    this.life = reduceLife(this.life, { type: 'peers', count: this.transport.peerIds().length })
    this.emitStatus()
  }

  private emitStatus(): void {
    const peerCount = this.transport.peerIds().length
    const relays = this.transport.relays()
    this.life = reduceLife(this.life, { type: 'relays', down: relays.length > 0 && relays.every((relay) => relay.readyState !== 1) })
    const phase = uiPhase(this.life)
    if (this.life.state === 'live') {
      this.setStatus({ phase, detail: connectedDetail(peerCount), relays, peerCount })
      return
    }
    if (this.life.state === 'failed') return
    const wait = waitingOrDown(this.strategy, this.life.state === 'relay_down' && relays.length === 0 ? [{ url: 'local', readyState: 3 }] : relays)
    this.setStatus({ phase: wait.phase, detail: this.life.state === 'joining' ? connectingDetail(this.strategy) : wait.detail, relays, peerCount })
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
    if (this.runtime.hidden()) {
      this.stopTimers()
      return
    }
    if (!this.isJoined()) return
    this.startTimers()
    void this.transport.send(createHelloPayload(this.identity.nick))
    this.emitStatus()
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
      this.emitStatus()
      for (const peerId of this.transport.peerIds()) void this.measure(peerId)
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
