import { MAX_MESSAGE_LENGTH, PROTOCOL_VERSION } from '../config/app'
import { sanitizeNick } from './identity'

export type HelloPayload = {
  v: typeof PROTOCOL_VERSION
  type: 'hello'
  nick: string
}

export type ChatPayload = {
  v: typeof PROTOCOL_VERSION
  type: 'chat'
  id: string
  ts: number
  nick: string
  text: string
}

export type TypingPayload = {
  v: typeof PROTOCOL_VERSION
  type: 'typing'
  nick: string
}

export type WirePayload = HelloPayload | ChatPayload | TypingPayload

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isVersion(value: unknown): value is typeof PROTOCOL_VERSION {
  return value === PROTOCOL_VERSION
}

export function createChatPayload(nick: string, text: string, id: string, ts: number): ChatPayload {
  return {
    v: PROTOCOL_VERSION,
    type: 'chat',
    id,
    ts,
    nick: sanitizeNick(nick),
    text: text.trim().slice(0, MAX_MESSAGE_LENGTH),
  }
}

export function createHelloPayload(nick: string): HelloPayload {
  return { v: PROTOCOL_VERSION, type: 'hello', nick: sanitizeNick(nick) }
}

export function createTypingPayload(nick: string): TypingPayload {
  return { v: PROTOCOL_VERSION, type: 'typing', nick: sanitizeNick(nick) }
}

export function parsePayload(value: unknown): WirePayload | null {
  if (!isRecord(value) || !isVersion(value.v) || typeof value.type !== 'string') {
    return null
  }

  const nick = typeof value.nick === 'string' ? sanitizeNick(value.nick) : ''
  if (!nick) return null

  if (value.type === 'hello') {
    return { v: PROTOCOL_VERSION, type: 'hello', nick }
  }

  if (value.type === 'typing') {
    return { v: PROTOCOL_VERSION, type: 'typing', nick }
  }

  if (value.type === 'chat') {
    if (typeof value.id !== 'string' || value.id.length < 8 || value.id.length > 80) {
      return null
    }
    if (typeof value.ts !== 'number' || !Number.isFinite(value.ts)) {
      return null
    }
    if (typeof value.text !== 'string') {
      return null
    }
    const text = value.text.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!text) return null
    return { v: PROTOCOL_VERSION, type: 'chat', id: value.id, ts: value.ts, nick, text }
  }

  return null
}
