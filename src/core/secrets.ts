import { recentRoomKey } from './room'
import type { RoomSpec } from './types'

const PREFIX = 'zenchat.pass.v1.'

function storageKey(spec: Pick<RoomSpec, 'name' | 'strategy'>): string {
  return PREFIX + recentRoomKey(spec)
}

export function rememberSecret(spec: RoomSpec): void {
  try {
    const key = storageKey(spec)
    if (spec.password) sessionStorage.setItem(key, spec.password)
    else sessionStorage.removeItem(key)
  } catch {
    // Private mode / quota: keep going with in-memory spec only.
  }
}

export function recallSecret(spec: Pick<RoomSpec, 'name' | 'strategy'>): string {
  try {
    return sessionStorage.getItem(storageKey(spec)) ?? ''
  } catch {
    return ''
  }
}

export function withSecret(spec: RoomSpec): RoomSpec {
  if (spec.password) {
    rememberSecret(spec)
    return spec
  }
  const password = recallSecret(spec)
  return password ? { ...spec, password } : spec
}
