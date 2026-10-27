import { BrowserTransfers, type TransferStore } from './transfers'
import type { ArrivalSettings, DevicePlatform } from './types'
import type { QuickShareAdapter } from './quick-share'
export interface DownloadRequest { url: string; name: string; itemId: string }
export type FileDrop = {type:'enter'|'over'|'leave'} | {type:'drop';paths:string[]}
export type AppearanceChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export interface AppearanceRequest { appearance:AppearanceChoice; resolvedTheme:ResolvedTheme; canvas:string; header:string; navigation:string }
export interface PlatformAdapter {
  kind: 'browser' | 'native';
  requiresConnection?: boolean;
  setAppearance?(request:AppearanceRequest):Promise<{systemTheme:ResolvedTheme}|void>;
  defaultDeviceName?: string;
  renameDevice?(name: string): Promise<void>;
  getOpenAtLogin?(): Promise<{enabled:boolean}>;
  setOpenAtLogin?(enabled:boolean): Promise<{enabled:boolean}>;
  quickShare?: QuickShareAdapter;
  deviceIdentity?: {id: string; platform: DevicePlatform};
  getArrivalSettings?(): Promise<ArrivalSettings>;
  setArrivalEnabled?(enabled: boolean): Promise<ArrivalSettings>;
  takeArrivalTarget?(): Promise<{baseUrl:string;itemId:string}|null>;
  disconnect?(): Promise<void>;
  copyText(text: string): Promise<void>;
  download(request: DownloadRequest): Promise<void>;
  transfers: TransferStore;
  /** Native pickers must enqueue into transfers without reading a whole file into JS. */
  chooseFiles?(kind: 'file' | 'text' | 'folder', sourceDevice: string, targetDeviceIds?: string[]): Promise<void>;
  onFileDrop?(receive:(event:FileDrop)=>void):Promise<()=>void|Promise<void>>;
  enqueuePaths?(paths:string[],targetDeviceIds:string[]):Promise<void>;
  /** Native runtime may supply an authenticated streaming fetch bridge. */
  request?: typeof fetch;
  baseURL?: string;
  configureConnection?(origin: string, token: string, sourceDevice?: string): Promise<void>;
  openEvents?(onRefresh: () => void, onStatus: (connected: boolean) => void): () => void;
}
declare global { interface Window { householdPlatform?: PlatformAdapter } }
export function browserPlatform(origin: string, onTransfer: () => void): PlatformAdapter {
  return {
    kind: 'browser', transfers: new BrowserTransfers(origin, onTransfer),
    async copyText(text) {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access needs HTTPS and browser permission. Download .txt or select the expanded text to copy manually.')
      await navigator.clipboard.writeText(text)
    },
    async download({ url, name }) {
      if (new URL(url).origin !== window.location.origin) throw new Error('Open Household on the server to download securely.')
      const link = document.createElement('a'); link.href = url; link.download = name; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove()
    },
  }
}
/** A rejection must reach the UI. Success is only announced after this promise resolves. */
export async function copyExactText(platform: Pick<PlatformAdapter, 'copyText'>, text: string): Promise<void> { await platform.copyText(text) }
