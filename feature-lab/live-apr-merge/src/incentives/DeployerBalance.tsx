import {useEffect,useState} from 'react'
import {formatEther,type Address} from 'viem'
import styled from 'styled-components'
import {useAdminHealth,type AdminHealth} from '../host/useAdminHealth'
import {OpsCard,OpsNote,OpsPill,OpsRow} from './operator-styles'
import {QuietButton} from './styles'

// Optional extension of the unchanged, pinned health API contract. Older hosts
// remain compatible and render Unavailable until they provide this metadata.
type BalanceCheck=AdminHealth['checks'][number]&{walletBalance?:{address:string;chainId:number;amountWei:string|null;minimumWei:string|null;observedAt:string|null}}

/** Operator-only, timestamped gas evidence. Failed, expired or legacy responses
 * are unavailable, never zero. The tooltip retains the full exact ETH value. */
export function DeployerBalance({report,onRefresh}:{report:AdminHealth|null;onRefresh:()=>void}){
 const balance=(report?.checks.find(c=>c.id==='server-gas') as BalanceCheck|undefined)?.walletBalance
 const [now,setNow]=useState(Date.now())
 const observed=Date.parse(balance?.observedAt??'')
 // Expire locally even when a slow health request remains pending. This timer
 // makes no API call and does not add another chain polling loop.
 useEffect(()=>{setNow(Date.now());if(!Number.isFinite(observed))return;const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,observed+25000-Date.now()));return()=>clearTimeout(timer)},[observed,report])
 const address=/^0x[0-9a-f]{40}$/i.test(balance?.address??'')?balance!.address:null
 const fresh=Boolean(address&&balance?.chainId===4663&&Number.isFinite(observed)&&now-observed>=-5000&&now-observed<25000)
 const known=fresh&&/^\d+$/.test(balance?.amountWei??'')&&/^\d+$/.test(balance?.minimumWei??'')
 const exact=known?formatEther(BigInt(balance!.amountWei!)):null,minimum=known?formatEther(BigInt(balance!.minimumWei!)):null
 const enough=known&&BigInt(balance!.amountWei!)>=BigInt(balance!.minimumWei!)
 const display=exact===null?'Unavailable':Number(exact)>0&&Number(exact)<0.00000001?'<0.00000001 ETH':(exact.split('.')[1]?.length>8?'≈ ':'')+exact.replace(/(\.\d{8})\d+$/,'$1')+' ETH'
 return <BalanceCard aria-label='Deployer wallet balance' data-deployer-balance>
  <OpsRow><div><OpsNote>Unrestricted factory deployer · Robinhood</OpsNote><BalanceAmount data-balance-value title={exact===null?undefined:exact+' ETH'}>{display}</BalanceAmount></div><OpsPill $state={!known?'unknown':enough?'ready':'blocked'}>{!known?'Balance unavailable':enough?'Gas reserve met':'Below startup minimum'}</OpsPill></OpsRow>
  <OpsRow><OpsNote>{address?<a href={'https://robinhoodchain.blockscout.com/address/'+address} target='_blank' rel='noreferrer'>{address}</a>:'Deployer wallet not verified'}<br/>{known?`Minimum ${minimum} ETH · Checked ${new Date(observed).toLocaleTimeString()}`:'Refresh to obtain a current balance.'}</OpsNote><QuietButton onClick={onRefresh}>Refresh balance</QuietButton></OpsRow>
 </BalanceCard>
}

/** Standalone campaigns use the existing authenticated health poll. Embedded
 * campaign tabs reuse their parent's card instead of polling twice. */
export function CampaignDeployerBalance({account}:{account:Address|null}){
 const health=useAdminHealth(account)
 return health.session?.operator?<DeployerBalance report={health.unavailable?null:health.report} onRefresh={health.refresh}/>:null
}
const BalanceCard=styled(OpsCard)`gap:12px;border-color:#493451;background:linear-gradient(110deg,#19101f,#0b0b0d);`
const BalanceAmount=styled.strong`display:block;margin-top:5px;font-size:28px;font-weight:500;line-height:1.3;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;`
