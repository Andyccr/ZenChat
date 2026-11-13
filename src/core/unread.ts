export function formatUnreadTitle(base: string, count: number): string {
  if (count <= 0) return base
  const n = count > 99 ? '99+' : String(count)
  return `(${n}) ${base}`
}

export function shouldCountUnread(line: { kind: string; self?: boolean }, hidden: boolean): boolean {
  return hidden && line.kind === 'chat' && line.self !== true
}
