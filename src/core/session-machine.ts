import type { SessionStatus } from './types'

export type LifeState = 'idle' | 'joining' | 'waiting' | 'live' | 'relay_down' | 'failed' | 'leaving'

export type Life = {
  state: LifeState
  peers: number
  relaysDown: boolean
}

export type LifeEvent =
  | { type: 'join' }
  | { type: 'join_ok' }
  | { type: 'join_err' }
  | { type: 'peers'; count: number }
  | { type: 'relays'; down: boolean }
  | { type: 'force_down' }
  | { type: 'leave' }
  | { type: 'left' }

export function idleLife(): Life {
  return { state: 'idle', peers: 0, relaysDown: false }
}

export function isJoined(life: Life): boolean {
  return life.state === 'joining' || life.state === 'waiting' || life.state === 'live' || life.state === 'relay_down'
}

function settle(life: Life): Life {
  if (life.state === 'idle' || life.state === 'failed' || life.state === 'joining' || life.state === 'leaving') {
    return life
  }
  if (life.peers > 0) return { ...life, state: 'live' }
  if (life.relaysDown) return { ...life, state: 'relay_down' }
  return { ...life, state: 'waiting' }
}

export function reduceLife(life: Life, event: LifeEvent): Life {
  switch (event.type) {
    case 'join':
      if (life.state === 'leaving') return life
      return { state: 'joining', peers: 0, relaysDown: false }
    case 'join_ok':
      if (life.state !== 'joining') return life
      return settle({ ...life, state: 'waiting' })
    case 'join_err':
      if (life.state !== 'joining') return life
      return { state: 'failed', peers: 0, relaysDown: false }
    case 'peers':
      if (!isJoined(life)) return life
      return settle({ ...life, peers: event.count })
    case 'relays':
      if (!isJoined(life)) return life
      return settle({ ...life, relaysDown: event.down })
    case 'force_down':
      if (!isJoined(life) || life.peers > 0) return life
      return { ...life, relaysDown: true, state: 'relay_down' }
    case 'leave':
      if (life.state === 'idle') return life
      return { ...life, state: 'leaving' }
    case 'left':
      return idleLife()
  }
}

export function uiPhase(life: Life): SessionStatus['phase'] {
  if (life.state === 'live') return 'connected'
  if (life.state === 'failed' || life.state === 'relay_down') return 'error'
  if (life.state === 'idle') return 'idle'
  return 'connecting'
}
