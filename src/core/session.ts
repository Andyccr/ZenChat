import { APP_ID, HELLO_INTERVAL_MS, RELAY_POLL_MS, TYPING_TTL_MS } from '../config/app'
import { randomHex } from './identity'
import {
  createChatPayload,
  createHelloPayload,
  createTypingPayload,
  parsePayload,
} from './protocol'
import { normalizeRoomName, roomNamespace } from './room'
import { TrysteroTransport } from './transports/trystero'
import type { SignallingTransport } from './transports/types'
import type {
  ChatLine,
  Identity,
  Member,
  RoomSpec,
  SessionStatus,
} from './types'

export type SessionListener = {
  onStatus?: (status: SessionStatus) => void
  onMembers?: (members: Member[]) => void
  onMessages?: (lines: ChatLine[]) => void
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
  private status: SessionStatus = {
    phase: 'idle',
    detail: '尚未连接',
    relays: [],
    peerCount: 0,
  }

  constructor(identity: Identity, listeners: SessionListener, transport?: SignallingTransport) {
    this.identity = identity
    this.listeners = listeners
    this.transport = transport ?? new TrysteroTransport('torrent')
  }

  get selfId(): string {
    return this.transport.selfId() || this.identity.id
  }

  async join(spec: RoomSpec): Promise<void> {
    await this.leave()
    this.transport = new TrysteroTransport(spec.strategy)
    this.setStatus({
      phase: 'connecting',
      detail: spec.strategy === 'torrent' ? '正在连接 WebTorrent Tracker…' : '正在连接 Nostr 中继…',
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
          this.refreshStatus('connected', `已与 ${this.transport.peerIds().length} 个节点直连`)
        },
        onPeerLeave: (peerId) => {
          const member = this.members.get(peerId)
          this.members.delete(peerId)
          this.pushSystem(`${member?.nick ?? peerId.slice(0, 6)} 离开了房间`)
          this.emitMembers()
          this.refreshStatus(
            this.transport.peerIds().length > 0 ? 'connected' : 'connecting',
            this.transport.peerIds().length > 0
              ? `已与 ${this.transport.peerIds().length} 个节点直连`
              : '等待其他浏览器加入同一房间',
          )
        },
        onPayload: (peerId, payload) => this.handlePayload(peerId, payload),
        onJoinError: (detail) => {
          this.refreshStatus('connecting', `握手受阻：${detail}`)
        },
      },
    )

    this.helloTimer = window.setInterval(() => {
      void this.transport.send(createHelloPayload(this.identity.nick))
    }, HELLO_INTERVAL_MS)

    this.relayTimer = window.setInterval(() => {
      this.refreshStatus(this.status.phase, this.status.detail)
    }, RELAY_POLL_MS)

    this.refreshStatus('connecting', '已宣布到公共信令网络，等待对等节点…')
  }

  async sendChat(text: string): Promise<void> {
    const payload = createChatPayload(this.identity.nick, text, randomHex(8), Date.now())
    if (!payload.text) return
    this.seen.add(payload.id)
    this.lines.push({
      kind: 'chat',
      id: payload.id,
      fromId: this.selfId,
      nick: this.identity.nick,
      text: payload.text,
      ts: payload.ts,
      self: true,
    })
    this.emitMessages()
    await this.transport.send(payload)
  }

  async sendTyping(): Promise<void> {
    await this.transport.send(createTypingPayload(this.identity.nick))
  }

  setNick(nick: string): void {
    this.identity = { ...this.identity, nick }
    void this.transport.send(createHelloPayload(nick))
  }

  async leave(): Promise<void> {
    if (this.helloTimer !== null) {
      window.clearInterval(this.helloTimer)
      this.helloTimer = null
    }
    if (this.relayTimer !== null) {
      window.clearInterval(this.relayTimer)
      this.relayTimer = null
    }
    for (const timer of this.typingTimers.values()) {
      window.clearTimeout(timer)
    }
    this.typingTimers.clear()
    await this.transport.leave()
    this.members.clear()
    this.lines = []
    this.seen.clear()
    this.setStatus({ phase: 'idle', detail: '已离开房间', relays: [], peerCount: 0 })
    this.emitMembers()
    this.emitMessages()
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
    this.lines.push({
      kind: 'chat',
      id: payload.id,
      fromId: peerId,
      nick: payload.nick,
      text: payload.text,
      ts: payload.ts,
      self: false,
    })
    this.emitMessages()
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
    this.lines.push({
      kind: 'system',
      id: randomHex(6),
      text,
      ts: Date.now(),
    })
    this.emitMessages()
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

  private emitMembers(): void {
    this.listeners.onMembers?.([...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt))
  }

  private emitMessages(): void {
    this.listeners.onMessages?.(this.lines)
  }
}
