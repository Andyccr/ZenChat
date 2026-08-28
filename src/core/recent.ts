import { MAX_RECENT_ROOMS } from '../config/app'
import { recentRoomKey } from './room'
import type { RoomSpec } from './types'

const KEY = 'zenchat.recentRooms'

export type RecentRoom = {
  name: string
  strategy: RoomSpec['strategy']
  hasPassword: boolean
  visitedAt: number
}

export function loadRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RecentRoom => {
        return (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as RecentRoom).name === 'string' &&
          ((item as RecentRoom).strategy === 'torrent' || (item as RecentRoom).strategy === 'nostr') &&
          typeof (item as RecentRoom).hasPassword === 'boolean' &&
          typeof (item as RecentRoom).visitedAt === 'number'
        )
      })
      .slice(0, MAX_RECENT_ROOMS)
  } catch {
    return []
  }
}

export function rememberRoom(spec: RoomSpec): RecentRoom[] {
  const next: RecentRoom = {
    name: spec.name,
    strategy: spec.strategy,
    hasPassword: Boolean(spec.password),
    visitedAt: Date.now(),
  }
  const others = loadRecentRooms().filter((item) => recentRoomKey(item) !== recentRoomKey(spec))
  const list = [next, ...others].slice(0, MAX_RECENT_ROOMS)
  localStorage.setItem(KEY, JSON.stringify(list))
  return list
}
