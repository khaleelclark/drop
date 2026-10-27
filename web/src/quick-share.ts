import type { NativeInvoke } from './native-platform'
import { validDeviceId, validItemId } from './devices'
import type { DevicePlatform } from './types'

export interface QuickDevice {id:string;label:string;platform:DevicePlatform}
export interface QuickContext {baseUrl:string;sourceDeviceId:string;sourceDevice:string;devices:QuickDevice[]}
export interface QuickRouting {baseUrl:string;sourceDeviceId:string;targetDeviceIds:string[]}
export interface QuickQueueReceipt {queued:number;cancelled:boolean}
export interface QuickShareAdapter {
  context():Promise<QuickContext>;
  paste():Promise<string>;
  sendText(routing:QuickRouting,text:string):Promise<{itemId:string}>;
  pick(routing:QuickRouting,kind:'file'|'folder'):Promise<QuickQueueReceipt>;
  drop(routing:QuickRouting,paths:string[]):Promise<QuickQueueReceipt>;
  resize(detail:boolean):Promise<void>;
  hide():Promise<void>;
  open():Promise<void>;
  quit():Promise<void>;
}
export const QUICK_TEXT_LIMIT=8*1024*1024
export function checkQuickText(value:unknown):asserts value is string {
  if(typeof value!=='string'||value.length===0)throw new Error('There is no plain text. Copy text and try Paste, or use Send Files.')
  if(value.length>QUICK_TEXT_LIMIT||new TextEncoder().encode(value).length>QUICK_TEXT_LIMIT)throw new Error('Text exceeds 8 MiB. Use Send Files for a text file; nothing was truncated.')
}
function contextReceipt(value:unknown):QuickContext {
  const context=value as QuickContext|null
  if(!context||typeof context.baseUrl!=='string'||!validDeviceId(context.sourceDeviceId)||typeof context.sourceDevice!=='string'||!context.sourceDevice.trim()||!Array.isArray(context.devices)||context.devices.length>64)throw new Error('The device list is invalid. Open Drop Settings and refresh.')
  const url=new URL(context.baseUrl)
  if(url.origin!==context.baseUrl||!['https:','http:'].includes(url.protocol))throw new Error('The household address is invalid. Open Drop Settings.')
  const ids=new Set<string>()
  for(const device of context.devices){
    if(!device||!validDeviceId(device.id)||ids.has(device.id)||typeof device.label!=='string'||!device.label.trim()||new TextEncoder().encode(device.label).length>128||/[\u0000-\u001f\u007f]/.test(device.label)||!['macos','linux','android','browser'].includes(device.platform))throw new Error('The device list is invalid. Open Drop Settings and refresh.')
    ids.add(device.id)
  }
  return context
}
export function nativeQuickShare(invoke:NativeInvoke):QuickShareAdapter {
  const payload=(routing:QuickRouting)=>({...routing,targetDeviceIds:[...routing.targetDeviceIds]})
  const queued=(value:unknown):QuickQueueReceipt=>{
    const receipt=value as QuickQueueReceipt|null
    if(!receipt||!Number.isSafeInteger(receipt.queued)||receipt.queued<0||receipt.queued>100||typeof receipt.cancelled!=='boolean'||(receipt.cancelled&&receipt.queued!==0))throw new Error('Queue acceptance could not be confirmed. Open Drop → Transfers before adding files again.')
    return receipt
  }
  return{
    async context(){return contextReceipt(await invoke('native_quick_context'))},
    async paste(){const text=await invoke('native_quick_paste');checkQuickText(text);return text},
    async sendText(routing,text){
      checkQuickText(text)
      const receipt=await invoke('native_quick_send_text',{...payload(routing),text}) as {itemId?:unknown}|null
      if(!receipt||typeof receipt.itemId!=='string'||!validItemId(receipt.itemId))throw new Error('Text could not be confirmed and may already be shared. Your draft is retained; check Open Drop before trying again.')
      return{itemId:receipt.itemId}
    },
    async pick(routing,kind){return queued(await invoke('native_quick_pick',{...payload(routing),kind}))},
    async drop(routing,paths){return queued(await invoke('native_quick_drop',{...payload(routing),paths:[...paths]}))},
    async resize(detail){await invoke('native_quick_resize',{detail})},
    async hide(){await invoke('native_quick_hide')},
    async open(){await invoke('native_quick_open')},
    async quit(){await invoke('native_quick_quit')},
  }
}
