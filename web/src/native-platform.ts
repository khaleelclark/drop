import type { PlatformAdapter } from './platform'
import type { Transfer, TransferState, TransferStore } from './transfers'
export type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
interface NativeTransfer { id: string; direction: 'upload' | 'download'; name: string; size: number; offset: number; status: string; error?: string; itemId?: string }
interface NativeConfig { baseUrl?: string; sourceDevice?: string; connected?: boolean }
declare global {
  interface Window {
    __TAURI__?: { core: { invoke: NativeInvoke } };
    __HOUSEHOLD_NATIVE__?: { platform: string; invoke: NativeInvoke };
  }
}
function wrapInvoke(invoke: NativeInvoke): NativeInvoke {
  return async (command, args) => { try { return await invoke(command, args) } catch (error) { throw error instanceof Error ? error : new Error(String(error)) } }
}
export function detectNativeInvoke(): NativeInvoke | undefined {
  if (window.__HOUSEHOLD_NATIVE__) return wrapInvoke(window.__HOUSEHOLD_NATIVE__.invoke.bind(window.__HOUSEHOLD_NATIVE__))
  if (window.__TAURI__?.core) return wrapInvoke(window.__TAURI__.core.invoke.bind(window.__TAURI__.core))
}
export function nativeTransferStatus(status:string):Pick<Transfer,'state'|'phase'> {
  const states:Record<string,TransferState>={queued:'queued',checking:'checking',hashing:'checking',staging:'checking',validating:'checking',exporting:'uploading',retry_wait:'paused',running:'uploading',paused:'paused',cancelling:'cancelling',complete:'complete',completed:'complete',error:'failed',needs_source:'needs-file'}
  const phases:Record<string,string>={staging:'Preparing local copy',validating:'Waiting for server validation',exporting:'Saving on this device',retry_wait:'Waiting to retry'}
  return {state:states[status]||'failed',...(phases[status]?{phase:phases[status]}:{})}
}
class NativeTransfers implements TransferStore {
  private rows: Transfer[] = []; private listeners = new Set<() => void>(); private timer?: ReturnType<typeof setInterval>
  private hidden = new Set<string>(); private refreshing = false
  constructor(private invoke: NativeInvoke, private origin: () => string) {}
  getSnapshot = () => this.rows
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    if (!this.timer) { void this.refresh(); this.timer = setInterval(() => void this.refresh(), 1000) }
    return () => { this.listeners.delete(fn); if (!this.listeners.size) { clearInterval(this.timer); this.timer = undefined } }
  }
  private async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const received = await this.invoke('native_list_transfers') as NativeTransfer[]
      const next: Transfer[] = received.filter(row => row.status !== 'cancelled' && !this.hidden.has(row.id)).map(row => ({
        id:row.id,name:row.name,size:row.size,lastModified:0,kind:'file',sourceDevice:'',destination:this.origin(),direction:row.direction,
        ...nativeTransferStatus(row.status),confirmed:row.offset,sent:row.offset,itemId:row.itemId,error:row.error,
      }))
      if (JSON.stringify(next) !== JSON.stringify(this.rows)) { this.rows = next; this.listeners.forEach(fn => fn()) }
    } catch (error) {
      // Keep durable queue entries visible; expose a bridge failure alongside their current state.
      const message = error instanceof Error ? error.message : String(error)
      if (this.rows.some(row => row.error !== message)) { this.rows = this.rows.map(row => ({...row,error:message})); this.listeners.forEach(fn => fn()) }
    } finally { this.refreshing = false }
  }
  enqueue() { throw new Error('Use Add files in the installed app to give the native queue access to your source.') }
  private async control(id: string, action: string) { await this.invoke('native_control',{id,action}); await this.refresh() }
  pause(id: string) { return this.control(id,'pause') }
  resume(id: string) { void this.control(id,'resume').catch(error => { this.rows=this.rows.map(row => row.id===id ? {...row,error:String(error)} : row); this.listeners.forEach(fn=>fn()) }) }
  cancel(id: string) { return this.control(id,'cancel') }
  reselect(id: string) { return this.control(id,'resume') }
  async reattach() { throw new Error('Use the installed app’s document picker to reselect the original source.') }
  clearCompleted() { this.rows.filter(row=>row.state==='complete').forEach(row=>this.hidden.add(row.id)); this.rows=this.rows.filter(row=>row.state!=='complete'); this.listeners.forEach(fn=>fn()) }
}
export async function nativePlatform(invoke: NativeInvoke): Promise<PlatformAdapter> {
  let config: NativeConfig = {}
  try { config = await invoke('native_get_config') as NativeConfig } catch { /* Older bridge: onboarding supplies the origin. */ }
  let origin = config.baseUrl || 'http://127.0.0.1:8787'
  const transfers = new NativeTransfers(invoke, () => origin)
  const request: typeof fetch = async (input, init) => {
    const signal=init?.signal
    if (signal?.aborted) throw new DOMException('Aborted','AbortError')
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/')) throw new Error('Only the configured household API can use the native bridge.')
    const requestId=crypto.randomUUID()
    let abort:(()=>void)|undefined
    const cancelled=signal?new Promise<never>((_resolve,reject)=>{
      abort=()=>{ void invoke('native_cancel_api',{requestId}).catch(()=>{});reject(new DOMException('Aborted','AbortError')) }
      signal.addEventListener('abort',abort,{once:true})
    }):undefined
    try {
      const operation=invoke('native_api',{method:init?.method || 'GET',path:url.pathname+url.search,requestId,...(init?.body ? {body:String(init.body)} : {})})
      const result=await (cancelled?Promise.race([operation,cancelled]):operation) as {status:number;body:string;headers?:Record<string,string>}
      if(signal?.aborted) throw new DOMException('Aborted','AbortError')
      return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:result.headers || {'Content-Type':url.pathname.endsWith('/text')?'text/plain; charset=utf-8':'application/json'}})
    } finally { if(signal&&abort)signal.removeEventListener('abort',abort) }
  }
  return {
    kind:'native',baseURL:origin,defaultDeviceName:config.sourceDevice,requiresConnection:!config.baseUrl || config.connected === false,transfers,request,
    async configureConnection(nextOrigin,token,sourceDevice) { await invoke('native_configure',{baseUrl:nextOrigin,token,sourceDevice:sourceDevice || config.sourceDevice || 'My device'}); origin=nextOrigin },
    async copyText(text) { await invoke('native_copy_text',{text}) },
    async download({itemId,name}) { await invoke('native_download',{itemId,name}) },
    async chooseFiles(kind,sourceDevice) { await invoke('native_pick_uploads',{kind,sourceDevice}) },
    openEvents(refresh,status) {
      let stopped=false; let pending=false
      const poll=async()=>{
        if(pending) return; pending=true
        try { const result=await request(`${origin}/api/health`); if(!stopped) { status(result.ok); refresh() } }
        catch { if(!stopped) status(false) } finally { pending=false }
      }
      void poll(); const timer=setInterval(()=>void poll(),5000);const focus=()=>void poll();window.addEventListener('focus',focus)
      return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);status(false)}
    },
    async disconnect() {
      try { await invoke('native_disconnect') }
      catch(error) {
        // Older shells did not expose disconnect; only an unsupported command permits fallback.
        if(!/unsupported|not found|unknown command/i.test(String(error))) throw error
        for(const row of transfers.getSnapshot()) if(['queued','checking','uploading'].includes(row.state)) await transfers.pause(row.id)
        await invoke('native_configure',{baseUrl:origin,token:'',sourceDevice:config.sourceDevice || 'My device'})
      }
    },
  }
}
