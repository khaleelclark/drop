import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startApplication } from './bootstrap'

afterEach(() => { delete window.__HOUSEHOLD_NATIVE__; delete window.householdPlatform; vi.unstubAllGlobals() })

describe('installed runtime startup failure', () => {
  it('shows a recoverable startup screen without falling back to browser transport', async () => {
    const browserFetch = vi.fn().mockRejectedValue(new Error('Browser transport must not run'))
    vi.stubGlobal('fetch', browserFetch)
    window.__HOUSEHOLD_NATIVE__ = {platform:'android',invoke:vi.fn().mockResolvedValue(null)}
    const element = document.createElement('div'); document.body.append(element)
    let root!: Awaited<ReturnType<typeof startApplication>>
    try {
      await act(async () => { root = await startApplication(element) })
      expect(screen.getByRole('heading',{name:'Couldn’t start Household'})).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('native components')
      expect(screen.getByRole('button',{name:'Try again'})).toBeEnabled()
      expect(screen.queryByRole('textbox',{name:'Text to share'})).not.toBeInTheDocument()
      expect(browserFetch).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); element.remove() }
  })
})
