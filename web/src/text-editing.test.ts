import { describe, it, expect } from 'vitest'
import { insertPlainText, preserveTextareaEdit } from './text-editing'
describe('plain text composer', () => {
  it('preserves exact pasted whitespace and original CRLF while editing through a textarea', () => {
    const pasted = '  a\r\nb\rc\n🦊\t  '
    expect(insertPlainText('', 0, 0, pasted)).toBe(pasted)
    expect(preserveTextareaEdit(pasted, '  a\nb\nc\n🦊\t  !')).toBe(`${pasted}!`)
    expect(insertPlainText(pasted, 4, 5, '💚\r\n')).toBe('  a\r\n💚\r\n\rc\n🦊\t  ')
  })
  it('preserves surrounding original line endings on replacement and deletion', () => {
    expect(preserveTextareaEdit('a\r\nb\r\nc', 'a\nB\nc')).toBe('a\r\nB\r\nc')
    expect(preserveTextareaEdit('a\r\nb\r\nc', 'a\nc')).toBe('a\r\nc')
  })
})
