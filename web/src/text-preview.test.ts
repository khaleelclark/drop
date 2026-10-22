import { describe, it, expect } from 'vitest'
import { boundedPreview } from './text-preview'
describe('expanded text rendering budget',()=>{
  it('never exceeds UTF-8 byte budget or splits a Unicode code point',()=>{
    expect(boundedPreview('🦊🦊x',7)).toEqual({text:'🦊',truncated:true})
    expect(boundedPreview('café',5)).toEqual({text:'café',truncated:false})
    expect(boundedPreview('abc',0)).toEqual({text:'',truncated:true})
  })
})
