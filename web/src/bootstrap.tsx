import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { detectNativeInvoke, nativePlatform } from './native-platform'
import { errorMessage } from './types'

export async function startApplication(element: HTMLElement) {
  document.documentElement.toggleAttribute('data-native-android', window.__HOUSEHOLD_NATIVE__?.platform === 'android')
  const root = createRoot(element)
  try {
    const invoke = detectNativeInvoke()
    if (!window.householdPlatform && invoke) window.householdPlatform = await nativePlatform(invoke)
    root.render(<StrictMode><App /></StrictMode>)
    if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.householdPlatform) {
      window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}) })
    }
  } catch (error) {
    root.render(<main className="startup-error"><section className="modal" role="alert" aria-labelledby="startup-title">
      <h1 id="startup-title">Couldn’t start Zing</h1>
      <p>The installed client couldn’t connect to its native components. Reload the app to try again.</p>
      <p className="inline-error">{errorMessage(error)}</p>
      <button className="button primary" onClick={() => window.location.reload()}>Try again</button>
    </section></main>)
  }
  return root
}
