import { describe, expect, it } from 'vitest'
import { splitLinks } from './linkify'

describe('splitLinks', () => {
  it('keeps plain text as a single part', () => {
    expect(splitLinks('你好')).toEqual([{ type: 'text', value: '你好' }])
  })

  it('extracts http(s) URLs and leaves surrounding punctuation', () => {
    expect(splitLinks('看这个 https://andyccr.com/ZenChat/ 吧')).toEqual([
      { type: 'text', value: '看这个 ' },
      { type: 'link', href: 'https://andyccr.com/ZenChat/', value: 'https://andyccr.com/ZenChat/' },
      { type: 'text', value: ' 吧' },
    ])
    expect(splitLinks('去 https://example.com.')).toEqual([
      { type: 'text', value: '去 ' },
      { type: 'link', href: 'https://example.com', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ])
  })

  it('rejects non-http schemes that might sneak through', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([{ type: 'text', value: 'javascript:alert(1)' }])
  })
})
