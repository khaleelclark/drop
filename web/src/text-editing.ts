/** Textareas expose normalized newlines. Keep original pasted CR/LF bytes in state. */
export const textareaText = (text: string) => text.replace(/\r\n?/g, '\n')
function storedOffset(text: string, displayOffset: number) {
  let index = 0; let position = 0
  while (index < text.length && position < displayOffset) {
    if (text[index] === '\r' && text[index + 1] === '\n') index++
    index++; position++
  }
  return index
}
export function insertPlainText(previous: string, start: number, end: number, pasted: string) {
  return previous.slice(0, storedOffset(previous, start)) + pasted + previous.slice(storedOffset(previous, end))
}
export function preserveTextareaEdit(previous: string, nextDisplayValue: string) {
  const displayed = textareaText(previous)
  let start = 0
  while (start < displayed.length && start < nextDisplayValue.length && displayed[start] === nextDisplayValue[start]) start++
  let end = displayed.length; let nextEnd = nextDisplayValue.length
  while (end > start && nextEnd > start && displayed[end - 1] === nextDisplayValue[nextEnd - 1]) { end--; nextEnd-- }
  return insertPlainText(previous, start, end, nextDisplayValue.slice(start, nextEnd))
}
