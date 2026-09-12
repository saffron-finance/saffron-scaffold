import { useEffect,useState } from 'react'
import type { Address } from 'viem'
import { currentChainId,onWalletChange } from '../adapters/wallet/wallet'
import { OpsCard,OpsPill,OpsRow } from './operator-styles'

/** Inspect the selected wallet, never request accounts, switch its chain, or
 * send a transaction. This is separate from the server's Robinhood RPC check. */
export function OperatorWalletCheck({account,operator}:{account:Address|null;operator:boolean}){
  const [chain,setChain]=useState<number>(),[loading,setLoading]=useState(false)
  useEffect(()=>{
    let version=0,disposed=false
    async function read(){const request=++version;setLoading(true);setChain(undefined);let timer:ReturnType<typeof setTimeout>|undefined;try{const next=account?await Promise.race([currentChainId(),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),4000)})]):undefined;if(!disposed&&request===version)setChain(next)}catch{if(!disposed&&request===version)setChain(undefined)}finally{clearTimeout(timer);if(!disposed&&request===version)setLoading(false)}}
    const changed=()=>void read(),unsubscribe=onWalletChange(changed)
    void read();window.addEventListener('focus',changed)
    return()=>{disposed=true;unsubscribe();window.removeEventListener('focus',changed)}
  },[account])
  const state=!account||loading||chain===undefined?'unknown':chain===4663?'ready':'warning'
  return <OpsCard data-status-check='wallet'><OpsRow><h2>Connected wallet</h2><OpsPill $state={state}>{!account?'Not connected':loading?'Checking network':chain===4663?'Robinhood · 4663':chain===undefined?'Network not verified':'Different wallet network'}</OpsPill></OpsRow>
    <p>{account?<><code>{account}</code><br/>{operator?'Admin signature verified.':'Sign in to verify admin access.'}</>:'Connect your wallet. Only allowlisted admin wallets can read server diagnostics.'}</p>
    <p><b>Who: You</b><br/>{chain!==4663?'Select Robinhood Chain (4663) in the wallet before sending a transaction. The server RPC may be healthy while your wallet uses a different network.':'The selected wallet reports Robinhood. It must still approve and sign each transaction; a server health check cannot do that for it.'}</p>
  </OpsCard>
}
