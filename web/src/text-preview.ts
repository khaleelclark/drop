export const PREVIEW_LIMIT = 256 * 1024
/** Cap rendered UTF-8 text without splitting a code point or changing the copied body. */
export function boundedPreview(text: string, maxBytes = PREVIEW_LIMIT) {
  let index=0; let bytes=0
  while(index<text.length) {
    const cp=text.codePointAt(index)!
    const size=cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4
    if(bytes+size>maxBytes) break
    bytes+=size;index+=cp>0xffff?2:1
  }
  return {text:text.slice(0,index),truncated:index<text.length}
}
