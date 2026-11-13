import { MAX_SEEN_IDS, MAX_SYNC_CHARS, MAX_SYNC_LINES } from '../config/app'
import { durableLine, trimLines } from './cache'
import type { SyncLine } from './protocol'
import type { ChatLine, Delivery } from './types'

export class Transcript {
  private lines: ChatLine[] = []
  private seen = new Set<string>()
  private seenOrder: string[] = []
  private byId = new Map<string, ChatLine>()

  hydrate(lines: ChatLine[]): ChatLine[] {
    this.clear()
    this.lines = trimLines(lines.map(durableLine))
    for (const line of this.lines) {
      this.byId.set(line.id, line)
      if (line.kind === 'chat') this.remember(line.id)
    }
    return this.lines
  }

  snapshot(): ChatLine[] {
    return this.lines
  }

  get(id: string): ChatLine | undefined {
    return this.byId.get(id)
  }

  has(id: string): boolean {
    return this.seen.has(id)
  }

  remember(id: string): void {
    if (this.seen.has(id)) return
    this.seen.add(id)
    this.seenOrder.push(id)
    while (this.seenOrder.length > MAX_SEEN_IDS) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seen.delete(oldest)
    }
  }

  append(line: ChatLine): ChatLine | null {
    if (line.kind === 'chat') {
      if (this.seen.has(line.id)) return null
      this.remember(line.id)
    }
    this.lines.push(line)
    this.lines = trimLines(this.lines)
    this.reindex()
    return line
  }

  patchDelivery(id: string, delivery?: Delivery): ChatLine | null {
    const index = this.lines.findIndex((line) => line.id === id)
    const current = index >= 0 ? this.lines[index] : undefined
    if (index < 0 || !current || current.kind !== 'chat') return null
    const next = chatLine({
      id: current.id,
      fromId: current.fromId,
      nick: current.nick,
      text: current.text,
      ts: current.ts,
      self: current.self,
      ...(delivery ? { delivery } : {}),
    })
    this.lines[index] = next
    this.byId.set(id, next)
    return next
  }

  mergeSync(rows: SyncLine[], selfId: string): boolean {
    let added = false
    for (const row of rows) {
      if (this.seen.has(row.id)) continue
      this.remember(row.id)
      this.lines.push(
        chatLine({
          id: row.id,
          fromId: row.fromId,
          nick: row.nick,
          text: row.text,
          ts: row.ts,
          self: row.fromId === selfId,
        }),
      )
      added = true
    }
    if (!added) return false
    this.lines.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    this.lines = trimLines(this.lines)
    this.reindex()
    return true
  }

  exportSync(): SyncLine[] {
    const chats = this.lines.filter(
      (line): line is Extract<ChatLine, { kind: 'chat' }> =>
        line.kind === 'chat' && line.delivery !== 'pending' && line.delivery !== 'failed',
    )
    const picked: SyncLine[] = []
    let chars = 0
    for (let i = chats.length - 1; i >= 0; i -= 1) {
      const line = chats[i]
      if (!line) continue
      const nextChars = chars + line.text.length
      if (picked.length >= MAX_SYNC_LINES || (picked.length > 0 && nextChars > MAX_SYNC_CHARS)) break
      chars = nextChars
      picked.push({ id: line.id, fromId: line.fromId, nick: line.nick, text: line.text, ts: line.ts })
    }
    return picked.reverse()
  }

  clear(): void {
    this.lines = []
    this.seen.clear()
    this.seenOrder = []
    this.byId.clear()
  }

  private reindex(): void {
    this.byId.clear()
    for (const line of this.lines) this.byId.set(line.id, line)
  }
}

export function chatLine(input: {
  id: string
  fromId: string
  nick: string
  text: string
  ts: number
  self: boolean
  delivery?: Delivery
}): ChatLine {
  if (input.delivery) return { kind: 'chat', ...input, delivery: input.delivery }
  return {
    kind: 'chat',
    id: input.id,
    fromId: input.fromId,
    nick: input.nick,
    text: input.text,
    ts: input.ts,
    self: input.self,
  }
}

export function systemLine(id: string, text: string, ts: number): ChatLine {
  return { kind: 'system', id, text, ts }
}
