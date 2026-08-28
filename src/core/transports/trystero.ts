import type { MessageAction, Room } from '@trystero-p2p/torrent'
import { RTC_CONFIG } from '../../config/ice'
import { NOSTR_RELAYS, TORRENT_TRACKERS } from '../../config/trackers'
import type { RelayStatus, SignalStrategy } from '../types'
import type { JoinOptions, SignallingTransport, TransportHandlers } from './types'

type StrategyModule = {
  joinRoom: (
    config: {
      appId: string
      password?: string
      rtcConfig: RTCConfiguration
      relayConfig: { urls: string[] }
    },
    roomId: string,
    callbacks?: { onJoinError?: (details: { error: string; peerId?: string }) => void },
  ) => Room
  getRelaySockets: () => Record<string, { readyState?: number } | undefined>
  selfId: string
}

function socketState(sockets: Record<string, { readyState?: number } | undefined>): RelayStatus[] {
  return Object.entries(sockets).map(([url, socket]) => ({
    url,
    readyState: socket?.readyState ?? WebSocket.CLOSED,
  }))
}

export class TrysteroTransport implements SignallingTransport {
  readonly strategy: SignalStrategy
  private room: Room | null = null
  private action: MessageAction | null = null
  private module: StrategyModule | null = null

  constructor(strategy: SignalStrategy) {
    this.strategy = strategy
  }

  selfId(): string {
    return this.module?.selfId ?? ''
  }

  async join(options: JoinOptions, handlers: TransportHandlers): Promise<void> {
    await this.leave()
    this.module = await loadStrategy(options.strategy)

    const relayUrls = options.strategy === 'torrent' ? [...TORRENT_TRACKERS] : [...NOSTR_RELAYS]
    const room = this.module.joinRoom(
      {
        appId: options.appId,
        ...(options.password ? { password: options.password } : {}),
        rtcConfig: RTC_CONFIG,
        relayConfig: {
          urls: relayUrls,
        },
      },
      options.roomId,
      {
        onJoinError: (details) => {
          handlers.onJoinError(details.error || '无法与对等节点完成握手')
        },
      },
    )

    const action = room.makeAction('zen')
    action.onMessage = (data, { peerId }) => {
      handlers.onPayload(peerId, data)
    }
    room.onPeerJoin = (peerId) => handlers.onPeerJoin(peerId)
    room.onPeerLeave = (peerId) => handlers.onPeerLeave(peerId)

    this.room = room
    this.action = action
  }

  async leave(): Promise<void> {
    const room = this.room
    this.room = null
    this.action = null
    if (room) {
      try {
        await room.leave()
      } catch {
        // Room may already be torn down by the strategy.
      }
    }
  }

  async send(payload: unknown, target?: string): Promise<void> {
    if (!this.action) {
      throw new Error('尚未加入房间')
    }
    await this.action.send(payload as never, target ? { target } : undefined)
  }

  ping(peerId: string): Promise<number> {
    if (!this.room) return Promise.reject(new Error('未连接'))
    return this.room.ping(peerId)
  }

  peerIds(): string[] {
    return this.room ? Object.keys(this.room.getPeers()) : []
  }

  relays(): RelayStatus[] {
    if (!this.module) return []
    return socketState(this.module.getRelaySockets())
  }
}

const modules = new Map<SignalStrategy, Promise<StrategyModule>>()

async function loadStrategy(strategy: SignalStrategy): Promise<StrategyModule> {
  const cached = modules.get(strategy)
  if (cached) return cached
  const pending =
    strategy === 'torrent'
      ? import('@trystero-p2p/torrent').then((mod) => ({
          joinRoom: mod.joinRoom,
          getRelaySockets: mod.getRelaySockets,
          selfId: mod.selfId,
        }))
      : import('@trystero-p2p/nostr').then((mod) => ({
          joinRoom: mod.joinRoom,
          getRelaySockets: mod.getRelaySockets,
          selfId: mod.selfId,
        }))
  modules.set(strategy, pending)
  return pending
}

export function preloadStrategies(): void {
  const run = () => {
    void loadStrategy('torrent')
    void loadStrategy('nostr')
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 })
  else setTimeout(run, 300)
}
