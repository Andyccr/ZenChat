import type { RelayStatus, SignalStrategy } from '../types'

export type TransportHandlers = {
  onPeerJoin: (peerId: string) => void
  onPeerLeave: (peerId: string) => void
  onPayload: (peerId: string, payload: unknown) => void
  onJoinError: (detail: string) => void
}

export type JoinOptions = {
  appId: string
  roomId: string
  password?: string
  strategy: SignalStrategy
}

export interface SignallingTransport {
  readonly strategy: SignalStrategy
  selfId(): string
  join(options: JoinOptions, handlers: TransportHandlers): Promise<void>
  leave(): Promise<void>
  send(payload: unknown, target?: string): Promise<void>
  ping(peerId: string): Promise<number>
  peerIds(): string[]
  relays(): RelayStatus[]
}
