import { boundedPreview } from './text-preview'
// Metadata hints only. The /text endpoint validates all file bytes before preparation.
// Keep these lists matched to clients/shared/text-file-fixture.json by the fixture test.
export const textApplicationTypes = 'application/json application/ld+json application/javascript application/ecmascript application/xml application/yaml application/x-yaml application/toml application/sql application/graphql'.split(' ')
export const textExtensions = 'txt md markdown json jsonl ndjson yaml yml toml xml csv tsv log js mjs cjs jsx ts tsx py rs go c h cc cpp hpp java kt kts swift dart cs php rb sh bash zsh sql html htm css scss'.split(' ')
export const textFileAccept = ['text/*', ...textApplicationTypes, ...textExtensions.map(extension=>`.${extension}`)].join(',')
export function isTextFileCandidate({name,mimeType}: {name:string;mimeType?:string}) {
  const [type,...parameters]=(mimeType || '').toLowerCase().split(';')
  if (mimeType && !/^[\w!#$%&'*+.^|~-]+\/[\w!#$%&'*+.^|~-]+$/.test(type.trim())) return false
  const seen = new Set<string>()
  for (const parameter of parameters) {
    const match = /^\s*([^=\s]+)\s*=\s*(?:"([^"\\]*)"|([^"\s;]+))\s*$/.exec(parameter)
    if (!match || seen.has(match[1])) return false
    seen.add(match[1])
    if (match[1] === 'charset' && (match[2] ?? match[3]) !== 'utf-8') return false
  }
  const dot=name.lastIndexOf('.')
  return type.trim().startsWith('text/') || textApplicationTypes.includes(type.trim()) || (dot>=0 && textExtensions.includes(name.slice(dot+1).toLowerCase()))
}
export function textDownloadName(name: string, format: 'txt'|'md') {
  const dot=name.lastIndexOf('.')
  const stem=(dot>0 ? name.slice(0,dot) : name) || 'Shared text'
  const suffix=`.${format}`
  return boundedPreview(stem,255-suffix.length).text+suffix
}
