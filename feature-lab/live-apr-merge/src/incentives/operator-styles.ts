import styled from 'styled-components'
import type { HealthState } from '../host/useAdminHealth'

const colors:Record<HealthState,string>={ready:'#76d7a0',blocked:'#ff9b92',warning:'#edcc83',unknown:'#c8cbd2',manual:'#d6b5ef'}
export const OpsCard=styled.section`min-width:0;border:1px solid #303037;border-radius:10px;background:#0b0b0d;padding:24px;display:flex;flex-direction:column;gap:16px;overflow-wrap:anywhere;h2,h3,p{margin:0}h2{font-size:20px;font-weight:500}h3{font-size:16px;font-weight:500}p,li{font-size:13px;line-height:1.65;color:#bfc0c7}code{font-size:12px;overflow-wrap:anywhere;white-space:normal}summary{cursor:pointer;font-size:13px;color:#d6b5ef}a{color:#d6b5ef}@media(max-width:650px){padding:18px}`
export const OpsGrid=styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;@media(max-width:750px){grid-template-columns:minmax(0,1fr)}`
export const MetricGrid=styled.div`display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;@media(max-width:950px){grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:370px){grid-template-columns:minmax(0,1fr)}`
export const OpsPill=styled.span<{$state:HealthState}>`display:inline-flex;align-items:center;gap:7px;align-self:flex-start;border:1px solid ${p=>colors[p.$state as HealthState]}66;color:${p=>colors[p.$state as HealthState]};background:${p=>colors[p.$state as HealthState]}0a;border-radius:5px;padding:5px 9px;font-size:11px;line-height:1.5;white-space:normal;&::before{content:'';width:6px;height:6px;flex-shrink:0;border-radius:50%;background:currentColor}`
export const OpsRow=styled.div`display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;min-width:0;`
export const OpsButtons=styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;button{min-width:0;white-space:normal}`
export const OpsNote=styled.p`margin:0;font-size:13px;line-height:1.6;color:#bfc0c7;overflow-wrap:anywhere;`
export const OpsTabs=styled.div`display:flex;gap:8px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid #303037;button{border:1px solid #303037;border-radius:5px;background:#101014;color:#bfc0c7;padding:10px 14px;font:inherit;font-size:12px;cursor:pointer}button[aria-pressed=true]{border-color:#aa73c4;color:#ead5f6;background:#291b34}`
