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
