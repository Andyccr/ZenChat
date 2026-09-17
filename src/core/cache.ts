import { MAX_LOG_LINES } from '../config/app'
import { sessionKey } from './room'
import type { ChatLine, RoomSpec } from './types'

const PREFIX = 'zenchat.cache.v1.'

export function cacheKey(spec: RoomSpec): string {
  return PREFIX + sessionKey(spec)
}

export function loadRoomLog(spec: RoomSpec): ChatLine[] {
  try {
    const raw = sessionStorage.getItem(cacheKey(spec))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatLine).slice(-MAX_LOG_LINES)
  } catch {
    return []
  }
}

export function durableLines(lines: ChatLine[]): ChatLine[] {
  return trimLines(lines.map(dropPendingDelivery))
}

export function saveRoomLog(spec: RoomSpec, lines: ChatLine[]): void {
  try {
    sessionStorage.setItem(cacheKey(spec), JSON.stringify(durableLines(lines)))
  } catch {
    // Quota errors are non-fatal; the live session still works.
  }
}

function dropPendingDelivery(line: ChatLine): ChatLine {
  if (line.kind !== 'chat' || line.delivery !== 'pending') return line
  return {
    kind: 'chat',
    id: line.id,
    fromId: line.fromId,
    nick: line.nick,
    text: line.text,
    ts: line.ts,
    self: line.self,
  }
}

export function trimLines(lines: ChatLine[]): ChatLine[] {
  return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES) : lines
}

function isChatLine(value: unknown): value is ChatLine {
  if (typeof value !== 'object' || value === null) return false
  const row = value as ChatLine
  if (row.kind === 'system') {
    return typeof row.id === 'string' && typeof row.text === 'string' && typeof row.ts === 'number'
  }
  if (row.kind === 'chat') {
    return (
      typeof row.id === 'string' &&
      typeof row.fromId === 'string' &&
      typeof row.nick === 'string' &&
      typeof row.text === 'string' &&
      typeof row.ts === 'number' &&
      typeof row.self === 'boolean'
    )
  }
  return false
}
