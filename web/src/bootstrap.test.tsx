import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startApplication } from './bootstrap'
import { nativePlatform, type NativeInvoke } from './native-platform'

afterEach(() => { delete window.__HOUSEHOLD_NATIVE__; delete window.__TAURI__; delete window.householdPlatform; document.documentElement.removeAttribute('data-native-android'); vi.unstubAllGlobals() })

describe('safe-area ownership at startup', () => {
  it.each(['android', 'macos', 'tauri-desktop', 'browser', 'native-adapter'])('marks only packaged Android before rendering: %s', async runtime => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Connect first"}}', {status:401})))
    const invoke = vi.fn<NativeInvoke>(async command => {
      if (command === 'native_get_config') return {}
      if (command === 'native_list_transfers') return []
      return {status:401,body:'{"error":{"message":"Connect first"}}'}
    })
    if (runtime === 'android' || runtime === 'macos') window.__HOUSEHOLD_NATIVE__ = {platform:runtime,invoke}
    if (runtime === 'tauri-desktop') window.__TAURI__ = {core:{invoke}}
    if (runtime === 'native-adapter') window.householdPlatform = await nativePlatform(invoke)
    const element = document.createElement('div'); document.body.append(element)
    let root!: Awaited<ReturnType<typeof startApplication>>
    try {
      await act(async () => { root = await startApplication(element) })
      expect(document.documentElement.hasAttribute('data-native-android')).toBe(runtime === 'android')
      expect(screen.getByRole('dialog', {name:'Connect to Household'})).toBeInTheDocument()
    } finally { await act(async () => root.unmount()); element.remove() }
  })
})

describe('installed runtime startup failure', () => {
  it('shows a recoverable startup screen without falling back to browser transport', async () => {
    const browserFetch = vi.fn().mockRejectedValue(new Error('Browser transport must not run'))
    vi.stubGlobal('fetch', browserFetch)
    window.__HOUSEHOLD_NATIVE__ = {platform:'android',invoke:vi.fn(async () => {
      expect(document.documentElement).toHaveAttribute('data-native-android')
      return null
    })}
    const element = document.createElement('div'); document.body.append(element)
    let root!: Awaited<ReturnType<typeof startApplication>>
    try {
      await act(async () => { root = await startApplication(element) })
      expect(screen.getByRole('heading',{name:'Couldn’t start Household'})).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('native components')
      expect(document.documentElement).toHaveAttribute('data-native-android')
      expect(screen.getByRole('button',{name:'Try again'})).toBeEnabled()
      expect(screen.queryByRole('textbox',{name:'Text to share'})).not.toBeInTheDocument()
      expect(browserFetch).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); element.remove() }
  })
})
