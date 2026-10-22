import { BrowserTransfers, type TransferStore } from './transfers'
export interface DownloadRequest { url: string; name: string; itemId: string }
export interface PlatformAdapter {
  kind: 'browser' | 'native';
  requiresConnection?: boolean;
  defaultDeviceName?: string;
  disconnect?(): Promise<void>;
  copyText(text: string): Promise<void>;
  download(request: DownloadRequest): Promise<void>;
  transfers: TransferStore;
  /** Native pickers must enqueue into transfers without reading a whole file into JS. */
  chooseFiles?(kind: 'file' | 'text', sourceDevice: string): Promise<void>;
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
