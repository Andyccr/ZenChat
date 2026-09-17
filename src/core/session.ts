import { ACK_TIMEOUT_MS, APP_ID, HELLO_INTERVAL_MS, PRESENCE_STALE_MS, RELAY_POLL_MS, TYPING_THROTTLE_MS } from '../config/app'
import { Heartbeat } from './heartbeat'
import { randomHex } from './identity'
import { Outbound } from './outbound'
import { applyIncoming } from './payload-router'
import { Presence } from './presence'
import {
  createAckPayload,
  createChatPayload,
  createHelloPayload,
  createTypingPayload,
  FEATURE_ACK,
  type ChatPayload,
} from './protocol'
import { normalizeRoomName, roomNamespace } from './room'
import { browserRuntime, type Runtime } from './runtime'
import { rafBatch, throttle } from './scheduler'
import { idleLife, isJoined, reduceLife, type Life } from './session-machine'
import { connectingDetail, deriveStatus, relaysAreDown, sameStatus, startFailedDetail, STATUS_COPY } from './status'
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
  private outbound: Outbound<ChatPayload>
  private heartbeat: Heartbeat
  private life: Life = idleLife()
  private strategy: SignalStrategy = 'torrent'
  private joinErrors = 0
  private epoch = 0
  private sendTypingThrottled: () => void
  private status: SessionStatus = {
    phase: 'idle',
    detail: STATUS_COPY.idle,
    relays: [],
    peerCount: 0,
  }

  private readonly emitMembers = rafBatch(() => {
    this.listeners.onMembers?.(this.presence.list())
  })

  constructor(identity: Identity, listeners: SessionListener, options: SessionOptions = {}) {
    this.identity = identity
    this.listeners = listeners
    this.createTransport = options.createTransport ?? createTransport
    this.runtime = options.runtime ?? browserRuntime
    this.transport = this.createTransport('torrent')
    this.presence = new Presence(this.runtime, () => this.emitMembers())
    this.outbound = new Outbound(this.runtime, ACK_TIMEOUT_MS, (id) => this.expireAck(id))
    this.heartbeat = new Heartbeat(this.runtime, HELLO_INTERVAL_MS, RELAY_POLL_MS, {
      onHello: () => this.announce(),
      onPoll: () => this.poll(),
    })
    this.sendTypingThrottled = throttle(() => {
      if (!this.isJoined()) return
      void this.transport.send(createTypingPayload(this.identity.nick))
    }, TYPING_THROTTLE_MS, () => this.runtime.now())
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
    await this.teardown(false)
    this.strategy = spec.strategy
    this.joinErrors = 0
    this.transport = this.createTransport(spec.strategy)
    this.life = reduceLife(idleLife(), { type: 'join' })
    this.setStatus({
      phase: 'connecting',
      detail: connectingDetail(spec.strategy),
      relays: [],
      peerCount: 0,
    })
    const token = this.epoch

    try {
      await this.transport.join(
        {
          appId: APP_ID,
          roomId: roomNamespace({ name: normalizeRoomName(spec.name), password: spec.password }),
          password: spec.password,
          strategy: spec.strategy,
        },
        {
          onPeerJoin: (peerId) => this.onPeerJoin(peerId),
          onPeerLeave: (peerId) => this.onPeerLeave(peerId),
          onPayload: (peerId, payload) => this.handlePayload(peerId, payload),
          onJoinError: (detail) => this.onJoinError(detail),
        },
      )
    } catch (error) {
      if (token !== this.epoch) return
      this.life = reduceLife(this.life, { type: 'join_err' })
      await this.teardown(false)
      const detail = error instanceof Error ? error.message : '连接失败'
      this.refreshStatus('error', startFailedDetail(detail))
      throw error
    }

    if (token !== this.epoch) {
      await this.transport.leave()
      return
    }

    this.life = reduceLife(this.life, { type: 'join_ok' })
    this.heartbeat.start()
    this.announce()
    this.emitStatus()
  }

  async sendChat(text: string): Promise<SendResult> {
    if (!this.isJoined()) return 'closed'
    const payload = createChatPayload(this.identity.nick, text, randomHex(8), this.runtime.now())
    if (!payload.text) return 'empty'
    return this.dispatch(payload, this.presence.supports(FEATURE_ACK))
  }

  async resend(id: string): Promise<SendResult> {
    if (!this.isJoined()) return 'closed'
    const line = this.transcript.get(id)
    if (!line || line.kind !== 'chat' || !line.self) return 'empty'
    if (line.delivery !== 'failed' && line.delivery !== 'pending') return 'empty'
    const stored = this.outbound.payload(id)
    const payload = stored ?? createChatPayload(this.identity.nick, line.text, line.id, line.ts)
    return this.dispatch(payload, this.presence.supports(FEATURE_ACK), true)
  }

  sendTyping(): void {
    this.sendTypingThrottled()
  }

  setNick(nick: string): void {
    this.identity = { ...this.identity, nick }
    if (this.isJoined()) this.announce()
  }

  async leave(options: { silent?: boolean } = {}): Promise<void> {
    this.life = reduceLife(this.life, { type: 'leave' })
    await this.teardown(true)
    this.life = reduceLife(this.life, { type: 'left' })
    if (!options.silent) {
      this.setStatus({ phase: 'idle', detail: STATUS_COPY.left, relays: [], peerCount: 0 })
      this.emitMembers()
      this.listeners.onReset?.([])
    }
  }

  private async teardown(wipeLog: boolean): Promise<void> {
    this.epoch += 1
    this.heartbeat.stop()
    this.outbound.dispose()
    this.outbound = new Outbound(this.runtime, ACK_TIMEOUT_MS, (id) => this.expireAck(id))
    this.presence.clear()
    await this.transport.leave()
    if (wipeLog) this.transcript.clear()
  }

  private live(token: number): boolean {
    return token === this.epoch && this.isJoined()
  }

  private async dispatch(payload: ChatPayload, expectAck: boolean, replace = false): Promise<SendResult> {
    const token = this.epoch
    if (replace) this.patchDelivery(payload.id, expectAck ? 'pending' : undefined)
    else {
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
    }
    try {
      await this.transport.send(payload)
    } catch {
      if (!this.live(token)) return 'closed'
      this.patchDelivery(payload.id, 'failed')
      this.pushSystem(STATUS_COPY.sendFailed)
      return 'failed'
    }
    if (!this.live(token)) return 'closed'
    if (expectAck) this.outbound.expect(payload.id, payload)
    return 'sent'
  }

  private handlePayload(peerId: string, raw: unknown): void {
    if (!this.isJoined()) return
    applyIncoming(peerId, raw, (id) => this.transcript.has(id), {
      hello: (id, nick, features) => {
        this.presence.upsert(id, nick, features)
        this.emitMembers()
      },
      typing: (id, nick) => {
        this.presence.upsert(id, nick)
        this.presence.markTyping(id)
        this.emitMembers()
      },
      ack: (id, messageId, nick) => {
        this.presence.upsert(id, nick)
        if (this.outbound.ack(messageId)) this.patchDelivery(messageId, 'acked')
      },
      chat: (id, incoming) => {
        this.presence.upsert(id, incoming.nick)
        if (incoming.duplicate) {
          void this.transport.send(createAckPayload(this.identity.nick, incoming.id), id)
          return
        }
        this.pushLine(
          chatLine({
            id: incoming.id,
            fromId: id,
            nick: incoming.nick,
            text: incoming.text,
            ts: incoming.ts,
            self: false,
          }),
        )
        void this.transport.send(createAckPayload(this.identity.nick, incoming.id), id)
        this.emitMembers()
      },
    })
  }

  private onPeerJoin(peerId: string): void {
    if (!this.isJoined()) return
    const token = this.epoch
    this.presence.upsert(peerId, '访客')
    this.pushSystem(`${peerId.slice(0, 6)} 加入了房间`)
    void this.transport.send(createHelloPayload(this.identity.nick), peerId)
    this.emitMembers()
    this.notePeers()
    this.runtime.setTimeout(() => {
      if (this.live(token)) void this.measure(peerId)
    }, 350)
  }

  private onPeerLeave(peerId: string): void {
    if (!this.isJoined()) return
    const member = this.presence.remove(peerId)
    this.pushSystem(`${member?.nick ?? peerId.slice(0, 6)} 离开了房间`)
    this.emitMembers()
    this.notePeers()
  }

  private onJoinError(detail: string): void {
    this.joinErrors += 1
    if (this.transport.peerIds().length > 0) return
    if (this.joinErrors >= 3) {
      this.life = reduceLife(this.life, { type: 'force_down' })
      this.emitStatus()
    } else this.refreshStatus('connecting', detail ? `${STATUS_COPY.handshake}（${detail}）` : STATUS_COPY.handshake)
  }

  private expireAck(id: string): void {
    if (!this.isJoined()) return
    this.patchDelivery(id, 'failed')
  }

  private patchDelivery(id: string, delivery?: 'acked' | 'failed' | 'pending'): void {
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

  private announce(): void {
    if (!this.isJoined()) return
    void this.transport.send(createHelloPayload(this.identity.nick))
  }

  private poll(): void {
    if (!this.isJoined()) return
    const gone = this.presence.prune(PRESENCE_STALE_MS, this.transport.peerIds())
    for (const member of gone) this.pushSystem(`${member.nick} 离开了房间`)
    if (gone.length > 0) this.emitMembers()
    this.notePeers()
    for (const peerId of this.transport.peerIds()) void this.measure(peerId)
  }

  private pushSystem(text: string): void {
    this.pushLine(systemLine(randomHex(6), text, this.runtime.now()))
  }

  private pushLine(line: ChatLine): void {
    const accepted = this.transcript.append(line)
    if (accepted) this.listeners.onLine?.(accepted)
  }

  private notePeers(): void {
    this.life = reduceLife(this.life, { type: 'peers', count: this.presence.list().length })
    this.emitStatus()
  }

  private emitStatus(): void {
    this.life = reduceLife(this.life, { type: 'relays', down: relaysAreDown(this.transport.relays()) })
    const next = deriveStatus({
      life: this.life,
      strategy: this.strategy,
      peerCount: this.presence.list().length,
      relays: this.transport.relays(),
    })
    if (next) this.setStatus(next)
  }

  private refreshStatus(phase: SessionStatus['phase'], detail: string): void {
    this.setStatus({
      phase,
      detail,
      relays: this.transport.relays(),
      peerCount: this.presence.list().length,
    })
  }

  private setStatus(status: SessionStatus): void {
    if (sameStatus(this.status, status)) return
    this.status = status
    this.listeners.onStatus?.(status)
  }
}
