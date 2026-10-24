import {useLayoutEffect,useRef,useState} from 'react'
import type {AppearanceChoice,AppearanceRequest,PlatformAdapter,ResolvedTheme} from './platform'
const nativeFailure='Native window appearance could not be updated. The app theme is still applied. Update this installed app for matching window and system bar colors.'
function saved():AppearanceChoice{try{const value=localStorage.getItem('zing.appearance');if(value==='light'||value==='dark')return value}catch{}return 'system'}
function hex(color:string){
  if(/^#[a-f0-9]{6}$/i.test(color))return color
  const rgb=color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(1))?\)$/)
  return rgb?'#'+rgb.slice(1,4).map(value=>Number(value).toString(16).padStart(2,'0')).join(''):undefined
}
function surface(node:Element|null,fallback:string){
  for(let element=node;element;element=element.parentElement){const color=hex(getComputedStyle(element).backgroundColor);if(color)return color}
  return fallback
}
export function useAppearance(platform:PlatformAdapter){
  const [value,setValue]=useState<AppearanceChoice>(saved),[resolved,setResolved]=useState<ResolvedTheme>('light'),[nativeError,setNativeError]=useState('')
  const preference=useRef<ResolvedTheme|undefined>(undefined),generation=useRef(0),preferenceVersion=useRef(0),pending=useRef<Promise<unknown>>(Promise.resolve())
  useLayoutEffect(()=>{
    const current=++generation.current,media=window.matchMedia?.('(prefers-color-scheme: dark)')
    const android=platform.kind==='native'&&(platform.deviceIdentity?.platform==='android'||document.documentElement.hasAttribute('data-native-android'))
    let lastRequest='',releasing=value==='system'&&Boolean(platform.setAppearance)
    const active=()=>generation.current===current
    const request=(theme:ResolvedTheme):AppearanceRequest|undefined=>{
      const canvas=hex(getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())
      if(!canvas)return
      return{appearance:value,resolvedTheme:theme,canvas,header:surface(document.querySelector('.topbar'),canvas),navigation:surface(document.querySelector('.mobile-tabs'),canvas)}
    }
    const sync=(settings:AppearanceRequest|undefined)=>{
      if(!settings||!platform.setAppearance)return Promise.resolve(undefined)
      const signature=JSON.stringify(settings);if(signature===lastRequest)return Promise.resolve(undefined)
      lastRequest=signature
      const task=pending.current.then(async()=>{if(!active())return;const version=preferenceVersion.current;const result=await platform.setAppearance!(settings);return{result,version}})
      pending.current=task.catch(()=>{})
      return task
    }
    const system=()=>android&&preference.current?preference.current:media?.matches?'dark':'light'
    const apply=(theme:ResolvedTheme=value==='system'?system():value)=>{
      if(!active())return
      document.documentElement.dataset.theme=theme;setResolved(theme)
      const settings=request(theme)
      if(settings)document.querySelector('meta[name=theme-color]')?.setAttribute('content',settings.canvas.toLowerCase())
      void sync(settings).then(receipt=>{
        if(!active()||!receipt)return
        setNativeError('')
        const result=receipt.result
        if(android&&result&&receipt.version===preferenceVersion.current)preference.current=result.systemTheme
        const next=android?preference.current:result?.systemTheme
        if(value==='system'&&next&&next!==theme)apply(next)
      }).catch(()=>{if(active())setNativeError(nativeFailure)})
    }
    const changed=()=>{if(!releasing)apply()}
    const nativeChanged=(event:Event)=>{
      if(!android||!(event instanceof CustomEvent)||!['light','dark'].includes(event.detail?.theme))return
      const theme=event.detail.theme as ResolvedTheme;preferenceVersion.current++;if(preference.current===theme)return
      preference.current=theme;if(value==='system'&&!releasing)apply(theme)
    }
    media?.addEventListener('change',changed);window.addEventListener('resize',changed);window.addEventListener('household-system-appearance',nativeChanged)
    if(releasing){
      const previous=document.documentElement.dataset.theme==='dark'?'dark':'light'
      void sync(request(previous)).then(receipt=>{
        if(!active())return
        const result=receipt?.result
        if(android&&result&&receipt?.version===preferenceVersion.current)preference.current=result.systemTheme
        releasing=false;apply(android?system():result?.systemTheme||system())
      }).catch(()=>{if(active()){releasing=false;apply();setNativeError(nativeFailure)}})
    }else apply()
    return()=>{generation.current++;media?.removeEventListener('change',changed);window.removeEventListener('resize',changed);window.removeEventListener('household-system-appearance',nativeChanged)}
  },[value,platform])
  return{value,resolved,nativeError,change:(next:AppearanceChoice)=>{setValue(next);try{localStorage.setItem('zing.appearance',next)}catch{}}}
}
export function Appearance({value,resolved,nativeError,change}:ReturnType<typeof useAppearance>){
  return <fieldset className="appearance-control"><legend>Appearance</legend><div>{(['light','dark','system'] as const).map(choice=><label key={choice}><input type="radio" name="appearance" value={choice} checked={value===choice} onChange={()=>change(choice)}/>{choice[0].toUpperCase()+choice.slice(1)}</label>)}</div>{value==='system'&&<p className="field-note">System — currently {resolved==='dark'?'Dark':'Light'}</p>}{nativeError&&<p className="field-note">{nativeError}</p>}</fieldset>
}
