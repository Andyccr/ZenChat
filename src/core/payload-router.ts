import { parsePayload } from './protocol'

export type Incoming =
  | { type: 'hello'; nick: string; features: string[] }
  | { type: 'typing'; nick: string }
  | { type: 'ack'; nick: string; id: string }
  | { type: 'chat'; nick: string; id: string; text: string; ts: number; duplicate: boolean }

export function decodeIncoming(raw: unknown, seen: (id: string) => boolean): Incoming | null {
  const payload = parsePayload(raw)
  if (!payload) return null
  if (payload.type === 'hello') return { type: 'hello', nick: payload.nick, features: payload.features }
  if (payload.type === 'typing') return { type: 'typing', nick: payload.nick }
  if (payload.type === 'ack') return { type: 'ack', nick: payload.nick, id: payload.id }
  return {
    type: 'chat',
    nick: payload.nick,
    id: payload.id,
    text: payload.text,
    ts: payload.ts,
    duplicate: seen(payload.id),
  }
}
