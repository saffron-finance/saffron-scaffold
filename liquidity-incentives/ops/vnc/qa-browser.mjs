/** Recover only the existing disposable browser context. Never create a context,
 * wallet or fixture, restart a service, or expose its loopback DevTools endpoint.
 */
import { chromium } from '@playwright/test'
import { settings } from './config.mjs'
import { fixtureOrigin } from './qa-status.mjs'

const endpoint='http://127.0.0.1:'+settings.debugPort
let recovery=null

/** Project browser availability without publishing target IDs or debug URLs. */
export async function browserStatus(data,{fetcher=fetch}={}){
  const origin=fixtureOrigin(data).origin
  try{
    const response=await fetcher(endpoint+'/json/list',{redirect:'error',signal:AbortSignal.timeout(2000)})
    if(!response.ok)throw Error('Browser unavailable')
    const targets=await response.json()
    if(!Array.isArray(targets))throw Error('Invalid browser state')
    return {available:true,open:targets.some(target=>target.type==='page'&&target.url?.startsWith(origin+'/'))}
  }catch{return {available:false,open:false}}
}

/** Narrow, independently testable recovery protocol. The one original incognito
 * context owns the generated wallet binding and storage. A new default context
 * would lose both, so ambiguity stops recovery instead of silently starting over.
 */
export async function reopenTarget(session,data){
  const origin=fixtureOrigin(data).origin
  const {browserContextIds}=await session.send('Target.getBrowserContexts')
  if(browserContextIds.length!==1)throw Error('Original test context is unavailable or ambiguous')
  const contextId=browserContextIds[0]
  const {targetInfos}=await session.send('Target.getTargets')
  const existing=targetInfos.find(target=>target.type==='page'&&target.browserContextId===contextId&&target.url?.startsWith(origin+'/'))
  let targetId=existing?.targetId
  if(!targetId){
    // Open saved requests, never a payment action or checkout. Context-level
    // scripts reconnect the same generated wallet and restore its local clock.
    const target=await session.send('Target.createTarget',{url:origin+'/portfolio/vaults',browserContextId:contextId})
    targetId=target.targetId
  }
  await session.send('Target.activateTarget',{targetId})
  return {reopened:!existing,preserved:true}
}

/** The temporary CDP client disconnects after recovery; closing this connection
 * does not terminate the fixture-owned Chromium process. No wallet method is
 * invoked and no existing application tab is navigated or reloaded.
 */
export function reopenBrowser(data){
  fixtureOrigin(data)
  if(recovery)return recovery
  // Simultaneous double clicks share one recovery, so they cannot create two
  // replacement tabs. A failed operation always releases this latch for retry.
  recovery=(async()=>{
    const browser=await chromium.connectOverCDP(endpoint,{timeout:5000})
    let deadline
    try{
      const session=await browser.newBrowserCDPSession()
      const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Browser recovery timed out')),7000)})
      return await Promise.race([reopenTarget(session,data),timeout])
    }finally{clearTimeout(deadline);await browser.close()}
  })().finally(()=>{recovery=null})
  return recovery
}
