import { useEffect,useState,type FormEvent } from 'react'
import { concatHex,keccak256,type Address } from 'viem'
import styled from 'styled-components'
import { authedJson } from '../host/transport'
import { Action,ErrorText,FinePrint,QuietButton,Stack } from './styles'
import { TokenIcon,TokenPicker,type PickerToken } from './TokenPicker'
import type { Pair } from './model'

type Pool={pool:Address;feeTier:number}
type Discovery={key:string;token0:PickerToken;token1:PickerToken;pools:Pool[]}
const tiers=[100,500,3000,10000]

/** Select reward/quote tokens, then an existing Uniswap fee tier. All saved
 * addresses and decimals come from the chain; this form never creates a pool. */
export function PairEditor({account,pairs,onSaved}:{account:Address;pairs:Pair[];onSaved:()=>Promise<void>}){
  const [tokens,setTokens]=useState<PickerToken[]>([]),[source,setSource]=useState('loading')
  const [token0,setToken0]=useState<PickerToken|null>(null),[token1,setToken1]=useState<PickerToken|null>(null)
  const [picker,setPicker]=useState<0|1|null>(null),[discovery,setDiscovery]=useState<Discovery|null>(null)
  const [fee,setFee]=useState<number|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const selectionKey=token0&&token1?token0.address.toLowerCase()+':'+token1.address.toLowerCase():''
  const current=discovery?.key===selectionKey?discovery:null
  const pool=current?.pools.find(p=>p.feeTier===fee)
  const listed=[...new Map([...pairs.flatMap(p=>[p.token0,p.token1]),...tokens].map(t=>[t.address.toLowerCase(),t])).values()]
  useEffect(()=>{
    let cancelled=false
    void authedJson(account,'/admin/tokens').then(value=>{if(!cancelled){setTokens(value.tokens);setSource(value.source)}})
      .catch(()=>{if(!cancelled)setSource('unavailable')})
    return()=>{cancelled=true}
  },[account])
  useEffect(()=>{
    let cancelled=false
    setDiscovery(null);setFee(null);setError('');setLoading(Boolean(selectionKey))
    if(!selectionKey)return
    const [address0,address1]=selectionKey.split(':')
    void authedJson(account,'/admin/pools?'+new URLSearchParams({token0:address0,token1:address1})).then(value=>{
      if(!cancelled){setDiscovery({...value,key:selectionKey});if(value.pools.length===1)setFee(value.pools[0].feeTier)}
    }).catch(e=>{if(!cancelled)setError((e as Error).message)}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[account,selectionKey,retry])
  async function submit(event:FormEvent){
    event.preventDefault();if(!pool||!current)return;setBusy(true);setError('')
    try{
      if(pairs.some(p=>p.pool.toLowerCase()===pool.pool&&p.token0.address.toLowerCase()===current.token0.address))throw new Error('This pool and reward token are already in the pair list.')
      // Pool + reward orientation is deterministic and does not use token symbols.
      const id='pair-'+keccak256(concatHex([pool.pool,current.token0.address])).slice(2)
      await authedJson(account,'/admin/pairs',{id,revision:0,chainId:4663,active:true,...pool,token0:current.token0,token1:current.token1})
      await onSaved()
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Form onSubmit={submit} aria-label='Add pair'><b>Add pair</b><FinePrint>Robinhood Chain · Select pair</FinePrint>
    <Selectors>{([0,1] as const).map((slot)=>{
      const token=slot===0?token0:token1
      return <Slot key={slot}>{slot===0?'Reward token':'Quote token'}<Trigger type='button' disabled={busy} aria-label={slot===0?'Select reward token':'Select quote token'} aria-haspopup='dialog' onClick={()=>setPicker(slot)}>
        {token?<><TokenIcon token={token}/><span>{token.symbol}</span></>:<span>Select a token</span>}<span aria-hidden='true'>⌄</span>
      </Trigger>{slot===0&&<Swap type='button' disabled={busy||(!token0&&!token1)} aria-label='Swap reward and quote tokens' onClick={()=>{setToken0(token1);setToken1(token0)}}>⇄</Swap>}</Slot>
    })}</Selectors>
    <FinePrint>The first token is the reward token. Use WETH for an ETH pool.</FinePrint>
    {source==='loading'&&<FinePrint role='status'>Loading token list… You can also paste an address.</FinePrint>}
    {['fallback','unavailable'].includes(source)&&<FinePrint>Full token list is unavailable. Use a listed token or paste a token address.</FinePrint>}
    <Stack><b>Fee tier</b><Fees>{tiers.map(tier=><Tier type='button' key={tier} aria-pressed={fee===tier} disabled={busy||loading||!current?.pools.some(p=>p.feeTier===tier)} onClick={()=>setFee(tier)}>{tier/10000}%</Tier>)}</Fees></Stack>
    {loading&&<FinePrint role='status'>Checking pools on chain…</FinePrint>}
    {current&&!current.pools.length&&<FinePrint>No supported pool exists for these tokens. Select a different pair.</FinePrint>}
    {pool&&current&&<FinePrint>Pool: {current.token0.symbol} / {current.token1.symbol} · {pool.feeTier/10000}%<br/><a href={'https://robinhoodchain.blockscout.com/address/'+pool.pool} target='_blank' rel='noreferrer'>{pool.pool}</a></FinePrint>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
    {selectionKey&&!loading&&!busy&&<QuietButton type='button' onClick={()=>setRetry(retry+1)}>Refresh pools</QuietButton>}
    <Action disabled={busy||loading||!pool}>{busy?'Saving pair…':'Save pair'}</Action>
    {picker!==null&&<TokenPicker key={picker} account={account} tokens={listed} other={(picker===0?token1:token0)?.address} onClose={()=>setPicker(null)} onSelect={token=>{(picker===0?setToken0:setToken1)(token);setPicker(null)}}/>}
  </Form>
}
const Form=styled.form`display:flex;flex-direction:column;gap:24px;padding:28px 32px;background:${p=>p.theme.colors.background.base};border:1px solid var(--line);border-radius:var(--radius-md);>b{font-family:${p=>p.theme.fonts.display};font-size:22px;font-weight:400}a{overflow-wrap:anywhere}@media(max-width:650px){padding:24px 16px}`
const Selectors=styled.div`display:flex;gap:52px;`
const Slot=styled.div`flex:1;min-width:0;position:relative;font-size:12px;color:${p=>p.theme.colors.text.secondary};`
const Trigger=styled.button`display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:50px;margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:var(--radius-md);color:${p=>p.theme.colors.text.primary};background:var(--surface-input);font-size:15px;cursor:pointer;span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}span:last-child{margin-left:auto} &:hover:not(:disabled),&:focus-visible{border-color:var(--line-strong);outline:1px solid var(--line-strong)}`
const Swap=styled(QuietButton)`position:absolute;right:-48px;bottom:3px;width:44px;height:44px;padding:0;font-size:22px;color:${p=>p.theme.colors.text.primary};`
const Fees=styled.div`display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;`
const Tier=styled(QuietButton)`min-height:44px;padding:10px 2px;&[aria-pressed='true']{color:${p=>p.theme.colors.accent.gold};border-color:${p=>p.theme.colors.accent.gold}} &:disabled{opacity:.3;cursor:not-allowed}`
