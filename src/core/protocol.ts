import { MAX_MESSAGE_LENGTH, PROTOCOL_VERSION } from '../config/app'
import { sanitizeNick } from './identity'

export const FEATURE_ACK = 'ack'

export type HelloPayload = {
  v: typeof PROTOCOL_VERSION
  type: 'hello'
  nick: string
  features: string[]
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

export type AckPayload = {
  v: typeof PROTOCOL_VERSION
  type: 'ack'
  id: string
  nick: string
}

export type WirePayload = HelloPayload | ChatPayload | TypingPayload | AckPayload

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isVersion(value: unknown): value is typeof PROTOCOL_VERSION {
  return value === PROTOCOL_VERSION
}

function readFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => item === FEATURE_ACK))]
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 8 || value.length > 80) return null
  return value
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
  return { v: PROTOCOL_VERSION, type: 'hello', nick: sanitizeNick(nick), features: [FEATURE_ACK] }
}

export function createTypingPayload(nick: string): TypingPayload {
  return { v: PROTOCOL_VERSION, type: 'typing', nick: sanitizeNick(nick) }
}

export function createAckPayload(nick: string, id: string): AckPayload {
  return { v: PROTOCOL_VERSION, type: 'ack', id, nick: sanitizeNick(nick) }
}

export function parsePayload(value: unknown): WirePayload | null {
  if (!isRecord(value) || !isVersion(value.v) || typeof value.type !== 'string') {
    return null
  }

  const nick = typeof value.nick === 'string' ? sanitizeNick(value.nick) : ''
  if (!nick) return null

  if (value.type === 'hello') {
    return { v: PROTOCOL_VERSION, type: 'hello', nick, features: readFeatures(value.features) }
  }

  if (value.type === 'typing') {
    return { v: PROTOCOL_VERSION, type: 'typing', nick }
  }

  if (value.type === 'ack') {
    const id = readId(value.id)
    if (!id) return null
    return { v: PROTOCOL_VERSION, type: 'ack', id, nick }
  }

  if (value.type === 'chat') {
    const id = readId(value.id)
    if (!id) return null
    if (typeof value.ts !== 'number' || !Number.isFinite(value.ts)) {
      return null
    }
    if (typeof value.text !== 'string') {
      return null
    }
    const text = value.text.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!text) return null
    return { v: PROTOCOL_VERSION, type: 'chat', id, ts: value.ts, nick, text }
  }

  return null
}
