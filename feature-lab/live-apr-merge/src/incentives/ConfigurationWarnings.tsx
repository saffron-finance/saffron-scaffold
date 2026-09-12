import { useCallback } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { readSession,requestJson } from '../host/transport'
import { usePollingResource } from '../host/usePollingResource'
import { walletConnectConfigured } from '../adapters/wallet/walletconnect'
import { FinePrint,QuietButton } from './styles'

type Setting={name:string;required:boolean;status:'configured'|'default'|'missing'|'invalid';impact:string}
type Report={checkedAt:string;settings:Setting[]}
const walletRpc=import.meta.env.VITE_WALLET_RPC_ROBINHOOD
const publicHttpUrl=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password}catch{return false}}
const browserSettings:Setting[]=[
  {name:'VITE_WALLETCONNECT_PROJECT_ID',required:false,status:walletConnectConfigured?'configured':import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?'invalid':'missing',impact:'WalletConnect QR connections are unavailable. Injected wallets still work. Set a valid Reown project ID and rebuild the frontend to enable QR connections.'},
  {name:'VITE_WALLET_RPC_ROBINHOOD',required:false,status:walletRpc?(publicHttpUrl(walletRpc)?'configured':'invalid'):'missing',impact:'Automatic network setup needs a public, credential-free RPC URL. Without it, add Robinhood to the wallet manually. Set this value and rebuild to enable automatic setup.'},
]

/** Read-only diagnostics never trigger a signature prompt. The existing admin
 * sign-in owns authentication. Keep this independent of catalog/status reads
 * so an outage cannot hide the configuration warning or imply a healthy state.
 */
export function ConfigurationWarnings({account,compact=false}:{account:Address|null;compact?:boolean}){
  const load=useCallback(async(signal:AbortSignal):Promise<{report:Report|null}>=>{
    if(!account)return {report:null}
    const session=await readSession(account,signal)
    if(!session?.operator)return {report:null}
    const report=await requestJson('/admin/configuration',undefined,signal)
    if(!Array.isArray(report.settings)||!report.checkedAt)throw new Error('Invalid configuration report')
    return {report}
  },[account])
  const poll=usePollingResource('configuration:'+account,load,'saffron:session')
  const settings=[...(poll.data?.report?.settings??[]),...browserSettings]
  const issues=settings.filter(setting=>['missing','invalid'].includes(setting.status))
  const unavailable=Boolean(poll.error),unverified=!poll.data?.report
  return <Panel aria-label='Application configuration' role={issues.length||unavailable?'alert':'region'}>
    <strong>{issues.length?'Configuration needs attention':unavailable?'Configuration check unavailable':unverified?'Configuration not verified':'Configuration settings checked'}</strong>
    {unavailable?<p>Cannot verify the current server settings. Check the API connection and sign in again if your session expired. Any previous results below may be out of date.</p>
      :unverified?<p>{poll.loading?'Checking configuration…':'Sign in with an admin wallet to check server settings. If sign-in is unavailable, check SAFFRON_APP_ORIGIN and SAFFRON_ADMIN_WALLETS on the server.'}</p>:null}
    {issues.length>0&&(compact&&!issues.some(s=>s.required)?<details><summary>{issues.length} optional features not configured</summary><ul>{issues.map(setting=><li key={setting.name}><code>{setting.name}</code><p>{setting.impact}</p></li>)}</ul></details>:<ul>{issues.map(setting=><li key={setting.name}><b>{setting.required?'Required setting':'Optional feature'} · {setting.status}</b><code>{setting.name}</code><p>{setting.impact}</p></li>)}</ul>)}
    <details><summary>Configuration checklist</summary>{settings.map(setting=><p key={setting.name}><code>{setting.name}</code> — {setting.status==='default'?'default / not required':setting.status}</p>)}</details>
    {!compact&&<FinePrint>Setting values are never shown. These checks do not open request intake or prove that the database, RPC, or signer is online.</FinePrint>}
    <QuietButton style={{alignSelf:'flex-start'}} onClick={poll.refresh}>Recheck configuration</QuietButton>
  </Panel>
}

const Panel=styled.section`border:1px solid #ad873e;background:#241e12;border-radius:var(--radius-md);padding:20px;display:flex;flex-direction:column;gap:12px;color:#f2dcac;overflow-wrap:anywhere;font-size:13px;line-height:1.5;strong{font-size:16px}p,ul{margin:0}ul{padding-left:20px}li+li{margin-top:16px}code{display:block;font-size:12px;white-space:normal}details p{margin-top:10px}summary{cursor:pointer}`
