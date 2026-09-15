import { toHash } from './router'
import type { RoomSpec } from './types'

export function roomUrl(origin: string, pathname: string, spec: RoomSpec, includePassword = false): string {
  return `${origin}${pathname}${toHash({ name: 'room', spec }, includePassword)}`
}

export async function shareOrCopy(url: string, title = '禅聊'): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url })
      return 'shared'
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'failed'
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
