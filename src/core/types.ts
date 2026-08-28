export type SignalStrategy = 'torrent' | 'nostr'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type Identity = {
  id: string
  nick: string
}

export type RoomSpec = {
  name: string
  password: string
  strategy: SignalStrategy
}

export type Member = {
  id: string
  nick: string
  joinedAt: number
  lastSeenAt: number
  rttMs: number | null
  typing: boolean
}

export type ChatLine =
  | {
      kind: 'chat'
      id: string
      fromId: string
      nick: string
      text: string
      ts: number
      self: boolean
    }
  | {
      kind: 'system'
      id: string
      text: string
      ts: number
    }

export type RelayStatus = {
  url: string
  readyState: number
}

export type SessionStatus = {
  phase: 'idle' | 'connecting' | 'connected' | 'error'
  detail: string
  relays: RelayStatus[]
  peerCount: number
}
