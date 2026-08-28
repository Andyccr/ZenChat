import { DEFAULT_ROOM } from '../config/app'
import { isSignalStrategy, normalizeRoomName } from './room'
import type { RoomSpec, SignalStrategy } from './types'

export type Route =
  | { name: 'lobby' }
  | { name: 'room'; spec: RoomSpec }

function readParam(params: URLSearchParams, key: string): string {
  return params.get(key) ?? ''
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const url = new URL(raw || '/', 'https://zenchat.local')
  const parts = url.pathname.split('/').filter(Boolean)

  if (parts[0] === 'r' && parts[1]) {
    const name = normalizeRoomName(decodeURIComponent(parts[1]))
    if (!name) return { name: 'lobby' }
    const strategyRaw = readParam(url.searchParams, 's')
    const strategy: SignalStrategy = isSignalStrategy(strategyRaw) ? strategyRaw : 'torrent'
    return {
      name: 'room',
      spec: {
        name,
        password: readParam(url.searchParams, 'k'),
        strategy,
      },
    }
  }

  return { name: 'lobby' }
}

export function toHash(route: Route, includePassword = false): string {
  if (route.name === 'lobby') return '#/'
  const params = new URLSearchParams()
  params.set('s', route.spec.strategy)
  if (includePassword && route.spec.password) {
    params.set('k', route.spec.password)
  }
  const query = params.toString()
  return `#/r/${encodeURIComponent(route.spec.name)}${query ? `?${query}` : ''}`
}

export function defaultRoomSpec(overrides: Partial<RoomSpec> = {}): RoomSpec {
  return {
    name: DEFAULT_ROOM,
    password: '',
    strategy: 'torrent',
    ...overrides,
  }
}
