// Synthetic native bridge only. No DOM input/focus overrides or household requests.
(() => {
  'use strict'
  const parameters = new URL(location.href).searchParams
  const scenario = parameters.get('case') || 'default'
  const mode = parameters.get('diagnostic') || 'baseline'
  const targetId = scenario === 'last' ? 'native-last' : 'native-note'
  const date = '2026-10-24T12:00:00Z'
  const text = '  Synthetic household note\n\tUnicode 🦊 café'
  const config = {baseUrl:'https://household.example',connected:true,sourceDevice:'Diagnostic Mac',deviceId:'11111111111111111111111111111111',platform:'macos',canRenameDevice:true}
  const device = {id:config.deviceId,label:config.sourceDevice,platform:'macos',createdAt:date}
  const note = {id:'native-note',kind:'text',name:'Native note',size:new TextEncoder().encode(text).length,createdAt:date,updatedAt:date,status:'ready',preview:'Synthetic preview',pinned:false}
  const file = i => ({id:i===8?'native-last':`native-file-${i}`,kind:'file',name:`Synthetic file ${i}.zip`,size:1024,createdAt:date,updatedAt:date,status:'ready',pinned:false,mimeType:'application/zip'})
  const items = scenario === 'last' ? [note,...Array.from({length:8},(_,i)=>file(i+1))] : [note]
  const state = {scenario,mode,targetId,attributeOverrides:[],deleteFailure:false,feedFailure:false,deleted:false,calls:[],events:[],truncated:false}
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect(), v = window.visualViewport
    const left=v?.offsetLeft||0, top=v?.offsetTop||0, right=left+(v?.width||innerWidth), bottom=top+(v?.height||innerHeight)
    const css=getComputedStyle(el), x=Math.max(left,r.left), y=Math.max(top,r.top), x2=Math.min(right,r.right), y2=Math.min(bottom,r.bottom)
    const hit=x2>x&&y2>y?document.elementFromPoint((x+x2)/2,(y+y2)/2):null
    return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left,visible:css.display!=='none'&&css.visibility!=='hidden'&&r.width>0&&r.height>0&&r.left>=left&&r.top>=top&&r.right<=right&&r.bottom<=bottom,uncovered:!!hit&&(hit===el||el.contains(hit))}
  }
  const meta = node => {
    if (!(node instanceof Element)) return null
    const el=node.closest('button,[role=menuitem],input,textarea,select')||node
    // Capture control names only; never preview/body values or input contents.
    return {nodeTag:node.tagName,nodeId:node.id,nodeConnected:node.isConnected,tag:el.tagName,id:el.id,connected:el.isConnected,tabindex:el.getAttribute('tabindex'),role:el.getAttribute('role'),label:el.getAttribute('aria-label'),name:el.matches('button,[role=menuitem]')?el.textContent.trim().slice(0,80):null}
  }
  const row = () => document.getElementById(`share-${targetId}`)
  const find = name => {
    if(name==='more')return row()?.querySelector('button[aria-haspopup="menu"][aria-label]')||null
    if(name==='action')return Array.from(row()?.querySelectorAll('[role=menuitem]')||[]).find(el=>el.textContent.trim()==='Delete item')||null
    if(name==='confirmation')return row()?.querySelector('[role=group][aria-label="Confirm deletion"]')||null
    if(name==='keep'||name==='delete')return Array.from(find('confirmation')?.querySelectorAll('button')||[]).find(el=>el.textContent.trim()===(name==='keep'?'Keep':'Delete'))||null
    if(name==='retry')return Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent.trim()==='Retry')||null
    if(name==='outside')return document.getElementById('feed-title')
    return null
  }
  let lastMenu = null
  const menuState = () => {
    const current = row()?.querySelector('[role=menu]') || null
    if(current)lastMenu=current
    return {present:!!current,previousDetached:!!lastMenu&&!lastMenu.isConnected}
  }
  const applyTabindex = () => {
    if(mode!=='tabindex')throw new Error('Attribute override requires explicit tabindex diagnostic mode')
    const menu = row()?.querySelector('[role=menu]'), trigger = find('more')
    if(!menu||!trigger)throw new Error('Open the rendered menu before applying attribute-only override')
    const nodes = [trigger,...menu.querySelectorAll('button[role=menuitem]')]
    const before = nodes.map(meta)
    for(const node of nodes)node.setAttribute('tabindex','0')
    const override = {kind:'DOM-attribute-only',attribute:'tabindex',value:'0',before,after:nodes.map(meta)}
    state.attributeOverrides.push(override)
    return {count:nodes.length,allExplicitZero:nodes.every(node=>node.getAttribute('tabindex')==='0')}
  }
  const snapshot = () => ({scenario,mode,targetId,menuState:menuState(),viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,visual:window.visualViewport?{offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale}:null},active:meta(document.activeElement),rowPresent:!!row(),queueRows:document.querySelectorAll('[role=group][aria-label^="To household: "],[role=group][aria-label^="To this device: "]').length,menu:rect(row()?.querySelector('[role=menu]')),confirmation:rect(find('confirmation')),keep:rect(find('keep')),deleteButton:rect(find('delete')),retry:rect(find('retry')),more:rect(find('more')),keepFocused:!!find('keep')&&document.activeElement===find('keep'),moreFocused:!!find('more')&&document.activeElement===find('more'),deleteEnabled:!!find('delete')&&!find('delete').disabled,errorVisible:Array.from(row()?.querySelectorAll('[role=alert]')||[]).some(el=>el.textContent.includes('Delete unavailable; try again')&&rect(el).visible),feedError:!!find('retry'),feedErrorVisible:!!find('retry')&&rect(find('retry')).visible,success:Array.from(document.querySelectorAll('[role=status]')).some(el=>el.textContent.includes('Item deleted.')),deleteCount:state.calls.filter(c=>c.method==='DELETE').length,feedErrors:state.calls.filter(c=>c.path?.startsWith('/api/items?')&&c.outcome==='offline').length,dom:Array.from(row()?.querySelectorAll('button,[role=menu],[role=group],[role=alert]')||[]).map(el=>({element:meta(el),rect:rect(el)}))})
  for(const type of ['pointerdown','mousedown','focusout','focusin','pointerup','mouseup','click','keydown','keyup'])document.addEventListener(type,event=>{
    if(state.events.length>=2000){state.truncated=true;return}
    state.events.push({type,trusted:event.isTrusted,key:event instanceof KeyboardEvent?event.key:undefined,target:meta(event.target),relatedTarget:meta(event.relatedTarget),activeElement:meta(document.activeElement),menuState:menuState(),menu:rect(row()?.querySelector('[role=menu]')),confirmation:rect(find('confirmation')),viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY}})
  },true)
  window.__deleteDiagnostic = {state,find,rect,snapshot,applyTabindex,report:()=>({...snapshot(),calls:state.calls,events:state.events,attributeOverrides:state.attributeOverrides,truncated:state.truncated,userAgent:navigator.userAgent})}
  const json = (value,status=200) => ({status,body:JSON.stringify(value)})
  window.__HOUSEHOLD_NATIVE__ = {platform:'macos',invoke:async(command,args={})=>{
    if(command==='native_get_config')return {...config}
    if(command==='native_get_arrival_settings')return {enabled:false,permission:'unknown',mode:'resident'}
    if(command==='native_take_arrival_target')return null
    if(command==='native_cancel_api')return null
    if(command==='native_list_transfers')return [
      {id:'upload',direction:'upload',name:'Family videos.zip',size:2*1024**3,offset:1024**3,status:'running'},
      {id:'validation',direction:'upload',name:'Notes.txt',size:1024,offset:1024,status:'validating'},
      {id:'download',direction:'download',name:'Holiday photos.zip',size:2*1024**3,offset:512*1024**2,status:'paused'}
    ]
    if(command!=='native_api'){state.calls.push({command,outcome:'unsupported'});throw new Error(`Unsupported diagnostic command: ${command}`)}
    const method=String(args.method||'GET'),path=String(args.path||'')
    const call={command,method,path,hasBody:args.body!==undefined,outcome:null};state.calls.push(call)
    const done=response=>{call.outcome=response.status;return response}
    if(method==='DELETE'&&path===`/api/items/${targetId}`){
      if(args.body!==undefined)return done(json({error:{code:'invalid_body',message:'Unexpected DELETE body'}},400))
      if(state.deleteFailure)return done(json({error:{code:'diagnostic_failure',message:'Delete unavailable; try again'}},500))
      state.deleted=true;return done({status:204,body:''})
    }
    if(method==='GET'&&path.startsWith('/api/items?')){
      if(state.feedFailure){call.outcome='offline';throw new Error('Synthetic network unavailable')}
      return done(json({items:items.filter(item=>!state.deleted||item.id!==targetId),nextCursor:null}))
    }
    if(method==='GET'&&path==='/api/devices')return done(json({devices:[device]}))
    if(method==='POST'&&path==='/api/devices/register')return done(json({device}))
    if(method==='GET'&&path==='/api/storage')return done(json({usedBytes:1024,freeBytes:100000000,maxFileBytes:21474836480,maxTextBytes:33554432,maxStorageBytes:null}))
    if(method==='GET'&&path==='/api/health')return done(json({status:'ok',version:'diagnostic'}))
    if(method==='GET'&&path.endsWith('/text')&&items.some(item=>path===`/api/items/${item.id}/text`))return done({status:200,body:text})
    if(method==='GET'&&path.startsWith('/api/items/')){
      const item=items.find(item=>path===`/api/items/${item.id}`&&(!state.deleted||item.id!==targetId))
      return done(item?json({item}):json({error:{code:'not_found',message:'Not found'}},404))
    }
    return done(json({error:{code:'unsupported_fixture',message:'Unsupported diagnostic API route'}},501))
  }}
})()
