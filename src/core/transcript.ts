import { MAX_SEEN_IDS } from '../config/app'
import { durableLine, trimLines } from './cache'
import type { ChatLine, Delivery } from './types'

export class Transcript {
  private lines: ChatLine[] = []
  private seen = new Set<string>()
  private seenOrder: string[] = []

  hydrate(lines: ChatLine[]): ChatLine[] {
    this.clear()
    this.lines = trimLines(lines.map(durableLine))
    for (const line of this.lines) {
      if (line.kind === 'chat') this.remember(line.id)
    }
    return this.lines
  }

  snapshot(): ChatLine[] {
    return this.lines
  }

  get(id: string): ChatLine | undefined {
    return this.lines.find((line) => line.id === id)
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
    return next
  }

  clear(): void {
    this.lines = []
    this.seen.clear()
    this.seenOrder = []
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
