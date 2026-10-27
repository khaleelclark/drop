import { useEffect, useState } from 'react'
import { Bell, Trash2 } from 'lucide-react'
import { ApiClient } from './api'
import { arrivalKey, browserArrivalPermission, browserArrivalsEnabled, enableBrowserArrivals } from './arrivals'
import type { PlatformAdapter } from './platform'
import { errorMessage, type ArrivalSettings, type Device } from './types'
export function DeviceSettings({api,platform,deviceId,devices,refresh,onArrivalChange,arrivalError,onBusyChange}:{api:ApiClient;platform:PlatformAdapter;deviceId:string;devices:Device[];refresh:()=>void;onArrivalChange:()=>void;arrivalError:string;onBusyChange?:(busy:boolean)=>void}) {
  const [settings,setSettings]=useState<ArrivalSettings>(); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [forget,setForget]=useState('')
  const key=arrivalKey(api.baseURL,deviceId)
  useEffect(()=>{
    let cancelled=false
    const load=async()=>{
      try {
        const next=platform.kind==='native'?await platform.getArrivalSettings!():{enabled:browserArrivalsEnabled(key),permission:browserArrivalPermission()==='default'?'prompt':browserArrivalPermission(),mode:'resident'} as ArrivalSettings
        if(!cancelled)setSettings(next)
      }catch(error){if(!cancelled)setError(errorMessage(error))}
    }
    const storage=(event:StorageEvent)=>{if(event.key===`${key}:enabled`||event.key===null)void load()}
    const focus=()=>void load()
    void load()
    if(platform.kind==='browser'){window.addEventListener('storage',storage);window.addEventListener('focus',focus)}
    return()=>{cancelled=true;window.removeEventListener('storage',storage);window.removeEventListener('focus',focus)}
  },[key,platform])
  const toggle=async()=>{
    setBusy(true);onBusyChange?.(true);setError('')
    try {
      const enabled=!settings?.enabled
      if(platform.kind==='native')setSettings(await platform.setArrivalEnabled!(enabled))
      else {await enableBrowserArrivals(key,enabled);setSettings({enabled,permission:browserArrivalPermission()==='default'?'prompt':browserArrivalPermission() as ArrivalSettings['permission'],mode:'resident'})}
      onArrivalChange()
    }catch(error){setError(errorMessage(error))}finally{setBusy(false);onBusyChange?.(false)}
  }
  const remove=async(id:string)=>{setBusy(true);onBusyChange?.(true);setError('');try{await api.forgetDevice(id);setForget('');refresh()}catch(error){setError(errorMessage(error))}finally{setBusy(false);onBusyChange?.(false)}}
  return <div className="device-settings"><section aria-labelledby="arrivals-title"><h3 id="arrivals-title"><Bell size={16}/>Arrival notifications</h3><p className="field-note">{platform.kind==='browser'?'Keep Drop open for notifications.':platform.deviceIdentity?.platform==='android'?'Android may delay checks by 15 minutes or more. Reopen Drop after reboot or force-stop.':'Notifications pause during Quit or sleep. Closing the window keeps Drop running.'}</p><p className="field-note">Alerts cover shares sent to this device or to Everyone, except those sent from this device. They may show the sender and a text preview or filename.</p><div className="arrival-controls"><span>{settings?`${settings.enabled?'Enabled':'Off'} · permission ${settings.permission}`:'Checking settings…'}</span><button className="button secondary" disabled={busy||!settings||!deviceId} onClick={()=>void toggle()}>{settings?.enabled?'Disable notifications':'Enable notifications'}</button></div>{settings?.lastCheckedAt&&<p className="field-note">Last checked: {new Date(settings.lastCheckedAt).toLocaleString()}</p>}{(error||arrivalError||settings?.lastError)&&<p className="inline-error" role="alert">{error||arrivalError||settings?.lastError}</p>}</section>
    <details><summary>Registered devices ({devices.length})</summary><p className="field-note">All shares is visible to everyone. Forgetting a device does not revoke access.</p>{devices.map(device=><div key={device.id} className="registered-device"><span><strong>{device.label}{device.id===deviceId?' (this device)':''}</strong><small>{device.platform} · {device.id.slice(-6)}</small></span>{device.id!==deviceId&&(forget===device.id?<div className="forget-confirm"><button className="button danger" disabled={busy} onClick={()=>void remove(device.id)}>Forget device</button><button className="text-button" onClick={()=>setForget('')}>Keep</button></div>:<button className="icon-button" aria-label={`Forget ${device.label} (${device.id.slice(-6)})`} onClick={()=>setForget(device.id)}><Trash2 size={16}/></button>)}</div>)}</details>
  </div>
}
