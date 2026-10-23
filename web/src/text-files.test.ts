import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTextFileCandidate, textApplicationTypes, textDownloadName, textExtensions, textFileAccept } from './text-files'
const fixture = JSON.parse(readFileSync('../clients/shared/text-file-fixture.json','utf8')) as {version:number;applicationTypes:string[];extensions:string[];cases:{name:string;mimeType:string;candidate:boolean}[]}
describe('root-owned textual file contract',()=>{
  it('matches both shared allowlists and picker hints without importing external files into the runtime build',()=>{
    expect(fixture.version).toBe(1)
    expect(textApplicationTypes).toEqual(fixture.applicationTypes);expect(textExtensions).toEqual(fixture.extensions)
    for(const mimeType of fixture.applicationTypes)expect(isTextFileCandidate({name:'noextension',mimeType})).toBe(true)
    for(const extension of fixture.extensions){expect(isTextFileCandidate({name:`code.${extension}`,mimeType:'application/octet-stream'})).toBe(true);expect(textFileAccept.split(',')).toContain(`.${extension}`)}
  })
  it.each(fixture.cases)('classifies $name ($mimeType) as candidate=$candidate',test=>{
    expect(isTextFileCandidate(test)).toBe(test.candidate)
  })
  it('rejects invalid/duplicate/empty charsets even when the filename suggests text',()=>{
    for(const mimeType of ['text/plain; charset=utf-16','application/octet-stream; charset="ISO-8859-1"','text/plain; charset=""','text/plain; charset=utf-8; charset=utf-16','text/plain; charset="utf-8','invalid; charset=utf-8'])expect(isTextFileCandidate({name:'code.md',mimeType})).toBe(false)
    expect(isTextFileCandidate({name:'note',mimeType:'text/plain; charset="UTF-8"'})).toBe(true)
    expect(isTextFileCandidate({name:'plain',mimeType:'text/markdown'})).toBe(true)
  })
  it.each([['code.go','md','code.md'],['notes.TXT','md','notes.md'],['.env','txt','.env.txt'],['.txt','md','.txt.md'],['.env.local','txt','.env.txt'],['','md','Shared text.md']] as const)('uses the fixed suffix and preserves dotfiles: %s', (name,format,expected)=>{
    expect(textDownloadName(name,format)).toBe(expected)
  })
  it('bounds suggested filenames at 255 UTF-8 bytes without splitting Unicode',()=>{
    const name='🦊'.repeat(63)+'家'+'x'.repeat(10)+'.go'
    for(const format of ['txt','md'] as const){
      const result=textDownloadName(name,format)
      expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(255)
      expect(result).toMatch(new RegExp(`\\.${format}$`));expect(result).not.toContain('\ufffd');expect(result).not.toContain('.go.')
      const stem=result.slice(0,-format.length-1);expect(name.startsWith(stem)).toBe(true)
    }
  })
})
