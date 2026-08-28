export const KAOMOJI = [
  '(´・ω・`)',
  '(｡•́︿•̀｡)',
  '(´▽`ʃ♡ƪ)',
  '(╯°□°）╯︵ ┻━┻',
  '¯\\_(ツ)_/¯',
  '(づ｡◕‿‿◕｡)づ',
  '(ง\'̀-\'́)ง',
  '(￣▽￣)',
  '(•̀ᴗ•́)و',
  'ฅ^•ﻌ•^ฅ',
  '(´；ω；`)',
  '(≧∇≦)ﾉ',
  '(´∀｀)♡',
  '┐(￣ヘ￣)┌',
] as const

export const EMOJI = ['😀', '😂', '🥰', '😎', '🤔', '😭', '🙏', '✨', '🔥', '🎉', '👍', '👋', '❤️', '🌸', '🍵', '🌙'] as const

const KAOMOJI_SET = new Set<string>(KAOMOJI)
const EMOJI_SET = new Set<string>(EMOJI)

export function isStamp(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (KAOMOJI_SET.has(trimmed) || EMOJI_SET.has(trimmed)) return true
  return trimmed.length <= 8 && /^[\p{Emoji_Presentation}\s]+$/u.test(trimmed)
}

export function insertAtCursor(field: HTMLTextAreaElement, text: string): void {
  const start = field.selectionStart
  const end = field.selectionEnd
  const next = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`
  field.value = next
  const caret = start + text.length
  field.setSelectionRange(caret, caret)
  field.focus()
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
