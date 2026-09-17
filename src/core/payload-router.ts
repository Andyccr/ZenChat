import { parsePayload } from './protocol'

export type Incoming =
  | { type: 'hello'; nick: string; features: string[] }
  | { type: 'typing'; nick: string }
  | { type: 'ack'; nick: string; id: string }
  | { type: 'chat'; nick: string; id: string; text: string; ts: number; duplicate: boolean }

export type IncomingHandler = {
  hello(peerId: string, nick: string, features: string[]): void
  typing(peerId: string, nick: string): void
  ack(peerId: string, id: string, nick: string): void
  chat(peerId: string, incoming: Extract<Incoming, { type: 'chat' }>): void
}

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

export function applyIncoming(
  peerId: string,
  raw: unknown,
  seen: (id: string) => boolean,
  handler: IncomingHandler,
): boolean {
  const incoming = decodeIncoming(raw, seen)
  if (!incoming) return false
  if (incoming.type === 'hello') handler.hello(peerId, incoming.nick, incoming.features)
  else if (incoming.type === 'typing') handler.typing(peerId, incoming.nick)
  else if (incoming.type === 'ack') handler.ack(peerId, incoming.id, incoming.nick)
  else handler.chat(peerId, incoming)
  return true
}
