import type { Life } from './session-machine'
import { uiPhase } from './session-machine'
import type { RelayStatus, SessionStatus, SignalStrategy } from './types'

export const STATUS_COPY = {
  idle: '尚未连接',
  left: '已离开房间',
  connectingTorrent: '正在连接 Tracker…',
  connectingNostr: '正在连接 Nostr…',
  waiting: '还没有同伴，把链接发给对方',
  handshake: '握手受阻，仍在重试',
  relaysDownTorrent: 'Tracker 连不上，可改用 Nostr',
  relaysDownNostr: 'Nostr 中继连不上，可改用 Tracker',
  sendFailed: '刚才那条没发出去，请再试一次',
}

export function connectingDetail(strategy: SignalStrategy): string {
  return strategy === 'nostr' ? STATUS_COPY.connectingNostr : STATUS_COPY.connectingTorrent
}

export function connectedDetail(peerCount: number): string {
  return `已直连 ${peerCount} 人`
}

export function startFailedDetail(reason: string): string {
  return `无法启动 P2P：${reason}`
}

export function openRelayCount(relays: RelayStatus[]): number {
  return relays.filter((relay) => relay.readyState === 1).length
}

export function relaysAreDown(relays: RelayStatus[]): boolean {
  return relays.length > 0 && openRelayCount(relays) === 0
}

export function waitingOrDown(strategy: SignalStrategy, relays: RelayStatus[]): Pick<SessionStatus, 'phase' | 'detail'> {
  if (relaysAreDown(relays)) {
    return {
      phase: 'error',
      detail: strategy === 'nostr' ? STATUS_COPY.relaysDownNostr : STATUS_COPY.relaysDownTorrent,
    }
  }
  return { phase: 'connecting', detail: STATUS_COPY.waiting }
}

export function deriveStatus(input: {
  life: Life
  strategy: SignalStrategy
  peerCount: number
  relays: RelayStatus[]
}): SessionStatus | null {
  if (input.life.state === 'failed') return null
  if (input.life.state === 'live') {
    return {
      phase: uiPhase(input.life),
      detail: connectedDetail(input.peerCount),
      relays: input.relays,
      peerCount: input.peerCount,
    }
  }
  const probes =
    input.life.state === 'relay_down' && input.relays.length === 0
      ? [{ url: 'local', readyState: 3 }]
      : input.relays
  const wait = waitingOrDown(input.strategy, probes)
  return {
    phase: wait.phase,
    detail: input.life.state === 'joining' ? connectingDetail(input.strategy) : wait.detail,
    relays: input.relays,
    peerCount: input.peerCount,
  }
}

export function sameStatus(prev: SessionStatus, next: SessionStatus): boolean {
  return (
    prev.phase === next.phase &&
    prev.detail === next.detail &&
    prev.peerCount === next.peerCount &&
    prev.relays.length === next.relays.length &&
    prev.relays.every((relay, i) => relay.readyState === next.relays[i]?.readyState)
  )
}
