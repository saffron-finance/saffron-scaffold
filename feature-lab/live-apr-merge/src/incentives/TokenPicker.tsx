import { useEffect,useMemo,useState,type ChangeEvent } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { authedJson } from '../host/transport'
import { Modal,ModalTitle } from '../host/ui'
import { ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'
import type { Token } from './model'

export type PickerToken=Token&{name?:string;logoURI?:string}
const shortAddress=(address:string)=>address.slice(0,8)+'…'+address.slice(-6)

/** Fixed-income-style searchable picker. Addresses, not symbols, identify rows.
 * The shared modal supplies focus trapping, Escape dismissal and focus return. */
export function TokenPicker({account,tokens,other,onSelect,onClose}:{account:Address;tokens:PickerToken[];other?:string;onSelect:(token:PickerToken)=>void;onClose:()=>void}){
  const [search,setSearch]=useState(''),[custom,setCustom]=useState<PickerToken|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const query=search.trim().toLowerCase(),isAddress=/^0x[0-9a-f]{40}$/.test(query)
  const known=tokens.some(t=>t.address.toLowerCase()===query)
  useEffect(()=>{
    let cancelled=false
    setCustom(null);setError('');setBusy(isAddress&&!known)
    if(!isAddress||known)return
    const timer=setTimeout(()=>{void authedJson(account,'/admin/tokens/'+query)
      .then(value=>{if(!cancelled)setCustom(value.token)})
      .catch(e=>{if(!cancelled)setError((e as Error).message)})
      .finally(()=>{if(!cancelled)setBusy(false)})},200)
    return()=>{cancelled=true;clearTimeout(timer)}
  },[account,query,isAddress,known])
  const matches=useMemo(()=>{
    const score=(t:PickerToken)=>t.symbol.toLowerCase()===query?0:t.symbol.toLowerCase().startsWith(query)?1:2
    return tokens.filter(t=>[t.symbol,t.name??'',t.address].some(text=>text.toLowerCase().includes(query)))
      .sort((a,b)=>score(a)-score(b)||a.symbol.localeCompare(b.symbol)||a.address.localeCompare(b.address))
  },[tokens,query])
  // Ignore an old lookup result during the render before its cleanup effect.
  const rows=custom?.address===query?[custom,...matches]:matches
  return <Modal isOpen onRequestClose={onClose}>
    <Stack><Row><ModalTitle>Select a token</ModalTitle><QuietButton type='button' aria-label='Close token picker' onClick={onClose}>Close</QuietButton></Row>
      <FinePrint>Search by name or paste a Robinhood token address.</FinePrint>
      <Search autoFocus aria-label='Search tokens' placeholder='Search name, symbol, or address' value={search} onChange={(e:ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} autoComplete='off'/>
      {busy&&<FinePrint role='status'>Reading token from chain…</FinePrint>}{error&&<ErrorText role='alert'>{error}</ErrorText>}
      <List aria-label='Token results'>{rows.slice(0,100).map(token=><TokenRow type='button' key={token.address} disabled={token.address.toLowerCase()===other?.toLowerCase()}
        aria-label={`Select ${token.symbol} ${token.address}`} onClick={()=>onSelect(token)}>
        <TokenIcon token={token}/><span><strong>{token.symbol}</strong> <Name>{token.name}</Name><small title={token.address}>{shortAddress(token.address)}{token.address.toLowerCase()===other?.toLowerCase()?' · Already selected':''}</small></span>
      </TokenRow>)}</List>
      {!rows.length&&!busy&&!error&&<FinePrint>No matching tokens. Paste a token contract address to look it up.</FinePrint>}
      {rows.length>100&&<FinePrint>Showing 100 of {rows.length} tokens. Refine your search to find a token.</FinePrint>}
    </Stack>
  </Modal>
}

/** The canonical USDG icon is bundled and keyed by address, never by a symbol
 * another contract can copy. Remote logo failure must not hide a new selection. */
export function TokenIcon({token}:{token:PickerToken}){
  const logo=token.address.toLowerCase()==='0x5fc5360d0400a0fd4f2af552add042d716f1d168'?import.meta.env.BASE_URL+'usdg.png':token.logoURI
  const [failedSource,setFailedSource]=useState<string>()
  return <Icon>{logo&&failedSource!==logo?<img src={logo} loading='lazy' referrerPolicy='no-referrer' alt='' onError={()=>setFailedSource(logo)}/>:token.symbol.slice(0,1)}</Icon>
}
const Search=styled.input`width:100%;min-width:0;padding:14px;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-input);color:inherit;font:inherit;`
const List=styled.div`height:320px;max-height:45dvh;overflow-y:auto;overscroll-behavior:contain;`
const TokenRow=styled.button`display:flex;gap:12px;align-items:center;text-align:left;width:100%;min-height:64px;padding:10px;border:0;border-radius:var(--radius-md);background:transparent;color:inherit;cursor:pointer;font:inherit;>span:last-child{min-width:0}small{display:block;font:11px ${p=>p.theme.fonts.mono};color:${p=>p.theme.colors.text.tertiary};margin-top:5px}strong{font-size:15px} &:hover:not(:disabled),&:focus-visible{background:var(--surface-input);outline:1px solid var(--line-strong)} &:disabled{opacity:.4;cursor:not-allowed}`
const Name=styled.span`color:${p=>p.theme.colors.text.secondary};font-size:12px;overflow-wrap:anywhere;`
const Icon=styled.span`display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;border-radius:50%;background:var(--surface-input);border:1px solid var(--line);font-size:12px;img{width:100%;height:100%;object-fit:contain;border-radius:50%}`
