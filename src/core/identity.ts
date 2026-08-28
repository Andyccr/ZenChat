import { MAX_NICK_LENGTH } from '../config/app'
import type { Identity } from './types'

const NICK_KEY = 'zenchat.nick'
const ID_KEY = 'zenchat.peerId'

const FALLBACK_NICKS = [
  '闲云',
  '青石',
  '疏影',
  '晚风',
  '折柳',
  '听雨',
  '归舟',
  '松风',
]

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function colorFromId(id: string): string {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 42% 46%)`
}

export function sanitizeNick(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  const stripped = [...collapsed]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join('')
  return stripped.slice(0, MAX_NICK_LENGTH)
}

export function defaultNick(id: string): string {
  const index = Number.parseInt(id.slice(0, 4), 16) % FALLBACK_NICKS.length
  return FALLBACK_NICKS[index] ?? '闲云'
}

export function loadIdentity(): Identity {
  const existingId = sessionStorage.getItem(ID_KEY)
  const id = existingId && /^[0-9a-f]{16,}$/i.test(existingId) ? existingId : randomHex(12)
  sessionStorage.setItem(ID_KEY, id)

  const storedNick = localStorage.getItem(NICK_KEY)
  const nick = sanitizeNick(storedNick ?? '') || defaultNick(id)
  localStorage.setItem(NICK_KEY, nick)
  return { id, nick }
}

export function persistNick(nick: string): string {
  const clean = sanitizeNick(nick) || defaultNick(loadIdentity().id)
  localStorage.setItem(NICK_KEY, clean)
  return clean
}
