import type { RelayStatus, SignalStrategy } from '../types'
import type { JoinOptions, SignallingTransport, TransportHandlers } from './types'

export class FakeTransport implements SignallingTransport {
  readonly strategy: SignalStrategy
  handlers: TransportHandlers | null = null
  sent: Array<{ payload: unknown; target?: string }> = []
  peers = new Set<string>()
  id = 'self-test'
  pingMs = 12
  joinGate: Promise<void> | null = null
  failJoin: Error | null = null
  private abandoned = false

  constructor(strategy: SignalStrategy = 'torrent') {
    this.strategy = strategy
  }

  selfId(): string {
    return this.id
  }

  async join(_options: JoinOptions, handlers: TransportHandlers): Promise<void> {
    this.abandoned = false
    if (this.joinGate) await this.joinGate
    if (this.abandoned) throw new Error('aborted')
    if (this.failJoin) throw this.failJoin
    this.handlers = handlers
  }

  async leave(): Promise<void> {
    this.abandoned = true
    this.handlers = null
    this.peers.clear()
  }

  async send(payload: unknown, target?: string): Promise<void> {
    if (target !== undefined) this.sent.push({ payload, target })
    else this.sent.push({ payload })
  }

  ping(_peerId: string): Promise<number> {
    return Promise.resolve(this.pingMs)
  }

  peerIds(): string[] {
    return [...this.peers]
  }

  relays(): RelayStatus[] {
    return []
  }

  peerJoin(peerId: string): void {
    this.peers.add(peerId)
    this.handlers?.onPeerJoin(peerId)
  }

  peerLeave(peerId: string): void {
    this.peers.delete(peerId)
    this.handlers?.onPeerLeave(peerId)
  }

  payload(peerId: string, data: unknown): void {
    this.handlers?.onPayload(peerId, data)
  }
}
