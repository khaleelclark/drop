import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeviceNamePrompt } from './DeviceNamePrompt'
describe('first-use name choice storage',()=>{
  it('remembers an explicit save even when the chosen name stays generic',async()=>{
    const rename=vi.fn().mockResolvedValue(undefined)
    const props={identityKey:'https://household.example:durable-device',name:'Desktop',rename}
    const view=render(<DeviceNamePrompt {...props}/>)
    fireEvent.click(screen.getByRole('button',{name:'Save name'}))
    await waitFor(()=>expect(screen.queryByRole('region')).not.toBeInTheDocument())
    expect(rename).toHaveBeenCalledWith('Desktop')
    view.unmount();render(<DeviceNamePrompt {...props}/>)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
  it('keeps the prompt and input when dismissal cannot be remembered',()=>{
    const rename=vi.fn()
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage blocked')})
    render(<DeviceNamePrompt identityKey="server:device" name="Desktop" rename={rename}/>)
    fireEvent.change(screen.getByRole('textbox',{name:'Device name'}),{target:{value:'My draft'}})
    fireEvent.click(screen.getByRole('button',{name:'Not now'}))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not remember this choice')
    expect(screen.getByRole('textbox',{name:'Device name'})).toHaveValue('My draft')
    expect(rename).not.toHaveBeenCalled()
  })
})
