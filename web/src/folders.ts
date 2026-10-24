import { BlobReader, ZipWriter, configure } from '@zip.js/zip.js/lib/zip-core.js'

export const folderUnsupported = 'Folder sharing needs directory access and private disk storage. Use an installed app or send a ZIP.'
export interface FolderEntry {
  name:string; kind:'file'|'directory';
  file?():Promise<File>;
  children?():AsyncIterable<FolderEntry>;
  same?(other:FolderEntry):Promise<boolean>;
}
type DirectoryHandle = FileSystemDirectoryHandle & {values():AsyncIterable<FileSystemHandle>}
type DropItem = DataTransferItem & {getAsFileSystemHandle?():Promise<FileSystemHandle|null>}
type PickerWindow = Window & {showDirectoryPicker?():Promise<FileSystemDirectoryHandle>}
export function handleEntry(handle:FileSystemHandle):FolderEntry {
  const entry:FolderEntry={name:handle.name,kind:handle.kind}
  if(handle.kind==='file')entry.file=()=>(handle as FileSystemFileHandle).getFile()
  else entry.children=async function*(){for await(const child of (handle as DirectoryHandle).values())yield handleEntry(child)}
  Object.defineProperty(entry,'handle',{value:handle})
  entry.same=other=>handle.isSameEntry((other as FolderEntry & {handle:FileSystemHandle}).handle)
  return entry
}
function legacyEntry(entry:FileSystemEntry):FolderEntry {
  return {name:entry.name,kind:entry.isDirectory?'directory':'file',
    ...(entry.isFile?{file:()=>new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject))}:entry.isDirectory?{
      children:async function*(){const reader=(entry as FileSystemDirectoryEntry).createReader();while(true){const children=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!children.length)break;for(const child of children)yield legacyEntry(child)}},
      same:async(other:FolderEntry)=>(other as FolderEntry & {path?:string}).path===entry.fullPath,
    }:{}),...{path:entry.fullPath}}
}
export function requireFolderStorage() {
  if(!navigator.storage?.getDirectory || typeof WritableStream==='undefined')throw new Error(folderUnsupported)
}
export async function pickFolder():Promise<FolderEntry> {
  requireFolderStorage()
  const picker=(window as PickerWindow).showDirectoryPicker
  if(!picker)throw new Error(folderUnsupported)
  return handleEntry(await picker.call(window))
}
// Capture handles during the drop event; the browser clears DataTransfer after it returns.
export function droppedEntries(data:DataTransfer):Promise<(File|FolderEntry)[]> {
  const items=Array.from(data.items).filter(item=>item.kind==='file') as DropItem[]
  if(!items.length)return Promise.resolve(Array.from(data.files))
  return Promise.all(items.map(item=>{
    if(item.getAsFileSystemHandle){const pending=item.getAsFileSystemHandle();const fallback=item.getAsFile();return pending.then(handle=>handle?handle.kind==='directory'?handleEntry(handle):(handle as FileSystemFileHandle).getFile():fallback||Promise.reject(new Error('A dropped source is unavailable. Add it again.')))}
    const entry=item.webkitGetAsEntry?.()
    if(entry?.isDirectory)return legacyEntry(entry)
    const file=item.getAsFile();if(file)return file
    return Promise.reject(new Error('A dropped source is unavailable. Add it again.'))
  }))
}
function diskLeaf(name:string){if(!/^[a-zA-Z0-9_-]{1,80}\.zip$/.test(name))throw new Error('Invalid prepared archive identity. Cancel and add the folder again.')}
const encoder=new TextEncoder(),MAX_ENTRIES=10000,MAX_PATH_BYTES=1024,MAX_NAMES_BYTES=4*1024*1024
function component(name:string) {
  if(!name||name==='.'||name==='..'||/[\\/:\x00-\x1f\x7f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||encoder.encode(name).length>240)throw new Error(`Unsupported folder entry: ${name.slice(0,100)||'(empty name)'}`)
}
export async function archiveDirectory(root:FolderEntry, diskName:string, maxBytes:number, signal:AbortSignal, progress:(bytes:number,total:number,phase:string)=>void):Promise<File> {
  requireFolderStorage();diskLeaf(diskName);component(root.name)
  if(root.kind!=='directory')throw new Error('Choose a folder.')
  let namesBytes=0,total=0,completed=0,written=0
  const entries:{entry:FolderEntry;path:string;size:number;modified:number}[]=[],names=new Set<string>()
  const active=()=>signal.throwIfAborted()
  async function visit(entry:FolderEntry,path:string,ancestors:FolderEntry[]) {
    active();component(entry.name)
    const bytes=encoder.encode(path).length
    if(bytes>MAX_PATH_BYTES||ancestors.length>64||entries.length>=MAX_ENTRIES||(namesBytes+=bytes)>MAX_NAMES_BYTES)throw new Error(`Folder is too complex at ${path.slice(0,120)} (10,000 entries / 64 levels / 4 MiB names maximum).`)
    const key=path.normalize('NFC').toLocaleLowerCase('en-US')
    if(names.has(key))throw new Error(`Duplicate archive path: ${path.slice(0,120)}`)
    names.add(key)
    if(entry.kind==='directory'){
      if(!entry.children||ancestors.includes(entry))throw new Error(`Unsupported or cyclic folder: ${path.slice(0,120)}`)
      for(const ancestor of ancestors)if(entry.same&&await entry.same(ancestor))throw new Error(`Cyclic folder: ${path.slice(0,120)}`)
      entries.push({entry,path:path+'/',size:0,modified:0})
      for await(const child of entry.children())await visit(child,path+'/'+child.name,[...ancestors,entry])
    } else {
      if(entry.kind!=='file'||!entry.file)throw new Error(`Unsupported entry: ${path.slice(0,120)}`)
      const file=await entry.file().catch(()=>{throw new Error(`Cannot read ${path.slice(0,120)}. Check source access and add the folder again.`)});active()
      if(!Number.isSafeInteger(file.size)||file.size<0||!Number.isFinite(file.lastModified))throw new Error(`Invalid source: ${path.slice(0,120)}`)
      total+=file.size;if(!Number.isSafeInteger(total)||total>maxBytes)throw new Error('Folder exceeds the server’s per-file limit. Split it into smaller folders.')
      entries.push({entry,path,size:file.size,modified:file.lastModified})
    }
    progress(0,total,'Checking folder')
  }
  await visit(root,root.name,[]);active()
  const reserve=total+entries.length*1024+namesBytes*4+1024
  const estimate=await navigator.storage.estimate();active()
  if(estimate.quota!==undefined&&reserve>estimate.quota-(estimate.usage||0))throw new Error('Not enough private disk space to prepare this folder. Free space or use an installed app.')
  const disk=await navigator.storage.getDirectory(),directory=await disk.getDirectoryHandle('drop-archives',{create:true})
  let sink:FileSystemWritableFileStream|undefined
  try {
    const handle=await directory.getFileHandle(diskName,{create:true});sink=await handle.createWritable();active()
    const output=new WritableStream<Uint8Array>({async write(chunk){active();written+=chunk.byteLength;if(written>maxBytes)throw new Error('Folder ZIP exceeds the server’s per-file limit.');await sink!.write(chunk as Uint8Array<ArrayBuffer>)}})
    // Sequential STORE entries avoid compression buffers and keep arbitrary bytes opaque.
    configure({chunkSize:256*1024,useWebWorkers:false})
    const zip=new ZipWriter(output,{zip64:true,bufferedWrite:false,level:0,useWebWorkers:false,signal})
    for(const record of entries){
      active();const {entry,path,size,modified}=record
      if(entry.kind==='directory')await zip.add(path,undefined,{directory:true})
      else {
        const file=await entry.file!();active()
        if(file.size!==size||file.lastModified!==modified)throw new Error(`Source changed: ${path.slice(0,120)}. Add the folder again.`)
        await zip.add(path,new BlobReader(file),{onprogress:bytes=>progress(completed+bytes,total,'Preparing folder ZIP')})
        const after=await entry.file!();active()
        if(after.size!==size||after.lastModified!==modified)throw new Error(`Source changed: ${path.slice(0,120)}. Add the folder again.`)
        completed+=size;progress(completed,total,'Preparing folder ZIP')
      }
    }
    const expected=new Map(entries.map(record=>[record.path,record]))
    let checkedEntries=0
    async function verify(entry:FolderEntry,path:string,depth:number):Promise<void>{
      active();const key=entry.kind==='directory'?path+'/':path,record=expected.get(key)
      if(depth>64||!record||record.entry.kind!==entry.kind||++checkedEntries>entries.length)throw new Error(`Folder changed at ${path.slice(0,120)}. Add it again.`)
      expected.delete(key)
      if(entry.kind==='directory'){for await(const child of entry.children!())await verify(child,path+'/'+child.name,depth+1)}
      else{const file=await entry.file!();if(file.size!==record.size||file.lastModified!==record.modified)throw new Error(`Source changed: ${path.slice(0,120)}. Add the folder again.`)}
    }
    await verify(root,root.name,0);if(expected.size)throw new Error('Folder changed during preparation. Add it again.')
    active();await zip.close();active();await sink.close();sink=undefined
    const file=await handle.getFile();active();return file
  }catch(error){
    try{await sink?.abort()}catch{/* The writer may already be aborted. */}
    await directory.removeEntry(diskName).catch(failure=>{if(!(failure instanceof DOMException&&failure.name==='NotFoundError'))throw new Error('Folder preparation stopped; local cleanup failed. Cancel to retry cleanup.')})
    if(error instanceof DOMException&&error.name==='QuotaExceededError')throw new Error('Private disk is full. Free space and add the folder again.')
    throw error
  }
}
export async function archiveFile(name:string) {requireFolderStorage();diskLeaf(name);return (await (await navigator.storage.getDirectory()).getDirectoryHandle('drop-archives')).getFileHandle(name).then(handle=>handle.getFile())}
export async function removeArchive(name:string) {requireFolderStorage();diskLeaf(name);await (await (await navigator.storage.getDirectory()).getDirectoryHandle('drop-archives')).removeEntry(name)}
