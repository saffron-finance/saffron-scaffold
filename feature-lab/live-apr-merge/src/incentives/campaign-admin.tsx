import { useEffect,useRef,useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { authedJson } from '../host/transport'
import type { Pair,Budget,Program } from './model'
import { QuietButton } from './styles'

export type CampaignCatalog={pairs:Pair[];budgets:Budget[];programs:Program[]}

/** Shared catalog reads for the manager and the separate creation page. A late
 * response must never repopulate a page after its wallet or route has changed. */
export function useCampaignCatalog(account:Address|null,onConnect:()=>void,autoLoad:boolean){
  const [catalog,setCatalog]=useState<CampaignCatalog|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const generation=useRef(0)
  async function load(){
    if(!account){onConnect();return false}
    const request=++generation.current
    setBusy(true);setError('')
    try{
      const next=await authedJson(account,'/admin/catalog')
      if(request!==generation.current)return false
      setCatalog(next);return true
    }catch(e){if(request===generation.current)setError((e as Error).message);return false}
    finally{if(request===generation.current)setBusy(false)}
  }
  useEffect(()=>{
    setCatalog(null);setError('');setBusy(false)
    if(autoLoad&&account)void load()
    return()=>{generation.current++}
  },[account,autoLoad])
  return {catalog,busy,error,load}
}

/** Display names are descriptive only; persisted program IDs remain visible. */
export function poolHeading(pair?:Pair){return pair?`${pair.token0.symbol} / ${pair.token1.symbol} · ${pair.feeTier/10000}%`:'Pool unavailable'}

export const Panel=styled.section`
  min-width:0;border:1px solid ${p=>p.theme.colors.border.base};border-radius:var(--radius-md);
  background:${p=>p.theme.colors.background.base};padding:24px;display:flex;flex-direction:column;gap:20px;
  h2,h3{margin:0;font-family:${p=>p.theme.fonts.display};font-weight:400;color:${p=>p.theme.colors.text.primary}}
  h2{font-size:24px}h3{font-size:20px}p{margin:0}
  @media(max-width:650px){padding:18px 14px}
`
export const SectionIntro=styled.div`display:flex;flex-direction:column;gap:7px;min-width:0;`
export const Field=styled.label`
  display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;line-height:1.5;color:${p=>p.theme.colors.text.secondary};
  input,select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;background:${p=>p.theme.colors.background.base};
    color:${p=>p.theme.colors.text.primary};border:1px solid ${p=>p.theme.colors.border.base};border-radius:var(--radius-md);padding:11px 12px;font:400 14px ${p=>p.theme.fonts.body};font-variant-numeric:tabular-nums;}
  input:focus-visible,select:focus-visible{outline:2px solid ${p=>p.theme.colors.accent.gold};outline-offset:2px}
  input:read-only{color:${p=>p.theme.colors.accent.gold};background:#18151d;border-style:dashed}
`
export const Fields=styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;@media(max-width:650px){grid-template-columns:minmax(0,1fr)}`
export const SaveButton=styled(QuietButton)`align-self:flex-start;border-color:${p=>p.theme.colors.border.base};min-height:40px;`
export const InlineForm=styled.form`display:flex;flex-direction:column;gap:10px;min-width:0;`
