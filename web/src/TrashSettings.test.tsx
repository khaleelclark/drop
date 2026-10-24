import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {TrashSettings} from './TrashSettings'
import {ApiClient} from './api'
afterEach(cleanup)
it('keeps a failed custom draft, refreshes by GET without repeating PATCH, and announces only persisted saves',async()=>{
  let persisted:number|null=30,fail=true
  const request=vi.fn().mockImplementation((_url,init)=>{
    if(init.method==='PATCH'){if(fail)return Promise.resolve(new Response('unavailable',{status:500}));persisted=JSON.parse(init.body).retentionDays}
    return Promise.resolve(new Response(JSON.stringify({retentionDays:persisted})))
  })
  render(<TrashSettings api={new ApiClient('https://household.example',request)}/>)
  const choice=await screen.findByLabelText('Automatically delete after');await waitFor(()=>expect(choice).toBeEnabled());expect(choice).toHaveValue('30')
  fireEvent.change(choice,{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('Custom days'),{target:{value:'45'}});fireEvent.click(screen.getByRole('button',{name:'Save retention'}))
  await screen.findByRole('alert');expect(screen.getByLabelText('Custom days')).toHaveValue(45);expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(persisted).toBe(30)
  fireEvent.click(screen.getByRole('button',{name:'Refresh saved setting'}));await waitFor(()=>expect(choice).toHaveValue('30'));expect(request.mock.calls.filter(([,init])=>init.method==='PATCH')).toHaveLength(1)
  fireEvent.change(choice,{target:{value:'never'}});fail=false;fireEvent.click(screen.getByRole('button',{name:'Save retention'}));await screen.findByRole('status');expect(persisted).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Automatic expiration is off')
})
it('rejects fractional custom input and guards duplicate pending saves',async()=>{
  let finish!:(response:Response)=>void
  const request=vi.fn().mockResolvedValueOnce(new Response('{"retentionDays":60}')).mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve}))
  render(<TrashSettings api={new ApiClient('https://household.example',request)}/>)
  const choice=await screen.findByLabelText('Automatically delete after');await waitFor(()=>expect(choice).toBeEnabled());expect(choice).toHaveValue('60');fireEvent.change(choice,{target:{value:'custom'}})
  const days=screen.getByLabelText('Custom days');fireEvent.change(days,{target:{value:'1.5'}});fireEvent.submit(days.closest('form')!);expect(screen.getByRole('alert')).toHaveTextContent('whole days');expect(request).toHaveBeenCalledTimes(1)
  fireEvent.change(days,{target:{value:'90'}});fireEvent.submit(days.closest('form')!);fireEvent.submit(days.closest('form')!);expect(request).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'Please wait…'})).toBeDisabled();expect(screen.queryByRole('status')).not.toBeInTheDocument()
  finish(new Response('{"retentionDays":90}'));await screen.findByRole('status')
})
it('shows no made-up default or futile controls on unsupported settings and retries temporary loads',async()=>{
  const request=vi.fn().mockResolvedValue(new Response('not found',{status:404}))
  const view=render(<TrashSettings api={new ApiClient('https://household.example',request)}/>)
  expect(screen.queryByLabelText('Automatically delete after')).not.toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('Update the household server to change automatic deletion.')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(request).toHaveBeenCalledTimes(1)
  view.unmount();request.mockResolvedValueOnce(new Response('temporary',{status:503})).mockResolvedValueOnce(new Response('{"retentionDays":90}'))
  render(<TrashSettings api={new ApiClient('https://household.example',request)}/>);await screen.findByRole('alert');expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByLabelText('Automatically delete after')).toHaveValue('90')
})
