import { MAX_ROOM_LENGTH } from '../config/app'
import type { RoomSpec, SignalStrategy } from './types'

export function isSignalStrategy(value: string): value is SignalStrategy {
  return value === 'torrent' || value === 'nostr'
}

export function normalizeRoomName(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[/#?&]+/g, '')
    .slice(0, MAX_ROOM_LENGTH)
}

export function roomNamespace(spec: Pick<RoomSpec, 'name' | 'password'>): string {
  const name = normalizeRoomName(spec.name)
  if (!spec.password) return name
  return `${name}::${spec.password}`
}

export function recentRoomKey(spec: Pick<RoomSpec, 'name' | 'strategy'>): string {
  return `${spec.strategy}:${normalizeRoomName(spec.name)}`
}

export function sessionKey(spec: RoomSpec): string {
  return `${spec.strategy}:${normalizeRoomName(spec.name)}:${spec.password}`
}

export function sameRoom(a: RoomSpec, b: RoomSpec): boolean {
  return sessionKey(a) === sessionKey(b)
}
