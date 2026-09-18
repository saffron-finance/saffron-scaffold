import styled from 'styled-components'
import type { Budget } from './model'
import { FinePrint } from './styles'

/** Format cents exactly, including negative target differences and values above
 * JavaScript's safe integer range. Missing evidence must never appear as $0. */
export function accountingUsd(value:string|number|null|undefined):string{
  if(value==null||!/^[-]?\d+$/.test(String(value)))return 'Unavailable'
  const cents=BigInt(value),abs=cents<0n?-cents:cents
  return `${cents<0n?'-':''}$${(abs/100n).toLocaleString('en-US')}.${String(abs%100n).padStart(2,'0')}`
}
const countText=(value:string|undefined)=>value!==undefined&&/^\d+$/.test(value)?BigInt(value).toLocaleString('en-US'):'Unavailable'

/** Separate lifetime request demand from current funded/reserved obligations.
 * The server supplies all-request statistics, never an average of a paginated
 * browser list. A mixed-version or unavailable API renders unknown, not zeros. */
export function FundingAccounting({budget}:{budget:Budget}){
  const accounting=budget.accounting,stats=budget.requestStatistics
  const noRequests=stats?.requestCount==='0'
  const average=(value:string|null|undefined)=>noRequests?'—':accountingUsd(value)
  const incomplete=stats&&(stats.unvaluedLpRequests!=='0'||stats.unvaluedPremiumRequests!=='0')
  const rows=[
    {label:'LP requests',value:countText(stats?.requestCount),note:'Number of accepted requests, not unique wallets.',section:'Request history'},
    {label:'Average LP size',value:average(stats?.averageLpCents),note:'Mean requested fixed-side capacity · USD.'},
    {label:'Maximum LP size',value:average(stats?.maximumLpCents),note:'Largest single requested fixed-side capacity · USD.'},
    {label:'Total LP requested',value:accountingUsd(stats?.totalLpCents),note:'Cumulative requested fixed-side capacity · USD.'},
    {label:'Average premium request',value:average(stats?.averagePremiumCents),note:'Mean requested premium · USD at request time.'},
    {label:'Maximum premium request',value:average(stats?.maximumPremiumCents),note:'Largest single requested premium · USD at request time.'},
    {label:'Total premium requested',value:accountingUsd(stats?.totalPremiumCents),note:'Cumulative requested premium, including later released requests.'},
    {label:'Premium reserved',value:accountingUsd(accounting?.reservedBudgetCents),note:'Current unfunded premium reservations; not a lifetime total.',section:'Current accounting'},
    {label:'LP capacity funded',value:accountingUsd(accounting?.fundedCapacityCents),note:'Fixed-side capacity supported by observed premium funding.'},
    {label:'LP capacity reserved',value:accountingUsd(accounting?.reservedCapacityCents),note:'Current committed fixed-side capacity not yet premium-funded.'},
    {label:'LP deposits observed',value:accountingUsd(accounting?.fixedDepositedCents),note:'Recorded LP entries, valued at request time; not current TVL.'},
    {label:'Original LP-capacity target',value:accountingUsd(accounting?.targetCapacityCents??budget.campaign?.capacityCents),note:'Original fixed-side planning target; not a request limit.',section:'Planning reference'},
    {label:'Remaining target LP capacity',value:accountingUsd(accounting?.availableCapacityCents),note:'Original target minus current committed capacity. Negative means above target.'},
    {label:'Original premium budget',value:accountingUsd(budget.campaign?.budgetCents),note:'Original quote-economics basis; separate from the editable planning budget.'},
  ]
  return <Accounting aria-label={'Funding and accounting for '+budget.id}>
    <Headline aria-label='Funding highlights'>
      <div><dt>Planning budget</dt><dd>{accountingUsd(budget.advisoryBudgetCents??budget.campaign?.budgetCents)}</dd><small>Current advisory target · USD</small></div>
      <div><dt>Premium funded</dt><dd>{accountingUsd(accounting?.fundedBudgetCents)}</dd><small>Recorded premium funding · USD</small></div>
      <div><dt>Cumulative premium requested</dt><dd>{accountingUsd(stats?.totalPremiumCents)}</dd><small>All accepted requests · USD</small></div>
      <div><dt>Number of requests</dt><dd>{countText(stats?.requestCount)}</dd><small>Paid, accepted vault requests</small></div>
    </Headline>
    <FinePrint>Request history includes all accepted requests, including subsequently failed, cancelled or released requests. Unpaid quotes are excluded. LP size means requested fixed-side capacity, not actual deposits.</FinePrint>
    {!stats&&<FinePrint role='status'>Request statistics are unavailable. Reload the catalog to check again.</FinePrint>}
    {incomplete&&<FinePrint role='status'>Some historical requests lack a recorded USD valuation. Affected totals, averages and maximums are unavailable.</FinePrint>}
    {noRequests&&<FinePrint>No accepted requests yet. Averages and maximums are shown as —.</FinePrint>}
    <TableFrame><DetailTable aria-label={'Accounting details for '+budget.id}>
      <thead><tr><th scope='col'>Metric</th><th scope='col'>Value</th><th scope='col'>Basis</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.label} data-accounting-metric={row.label} data-section-start={row.section||undefined}>
        <th scope='row'>{row.section&&<Category>{row.section}</Category>}{row.label}</th><td>{row.value}</td><td>{row.note}</td>
      </tr>)}</tbody>
    </DetailTable></TableFrame>
    <FinePrint>USD values use accepted request-time valuations. Premium amounts exclude the ETH request fee and wallet gas. Requested totals are demand, not a wallet balance or proof of funding.</FinePrint>
  </Accounting>
}
const Accounting=styled.section`display:flex;flex-direction:column;gap:16px;min-width:0;`
const Headline=styled.dl`
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border:1px solid #242124;border-radius:4px;background:#080808;
  >div{min-width:0;display:flex;flex-direction:column;gap:10px;padding:22px 20px;border-right:1px solid #1d1b1f}
  >div:last-child{border-right:0}dt,small{color:#9c969e;font:11px/1.5 ${p=>p.theme.fonts.mono};overflow-wrap:anywhere}
  dd{margin:0;font:400 29px/1.25 ${p=>p.theme.fonts.display};font-variant-numeric:tabular-nums;letter-spacing:-.025em;overflow-wrap:anywhere;color:${p=>p.theme.colors.text.primary}}small{font-size:10px}
  @media(max-width:1100px){grid-template-columns:repeat(2,minmax(0,1fr));>div:nth-child(2){border-right:0}>div:nth-child(-n+2){border-bottom:1px solid #1d1b1f}}
  @media(max-width:650px){>div{padding:16px 12px}dd{font-size:24px}}
  @media(max-width:370px){grid-template-columns:minmax(0,1fr);>div{border-right:0;border-bottom:1px solid #1d1b1f}>div:last-child{border-bottom:0}}
`
const TableFrame=styled.div`border:1px solid #242124;border-radius:4px;overflow:hidden;min-width:0;`
const DetailTable=styled.table`
  width:100%;border-collapse:collapse;table-layout:fixed;text-align:left;font-size:13px;
  thead th{background:#0b0a0b;color:#9c969e;font:400 10px/1.5 ${p=>p.theme.fonts.mono};padding:12px 16px}
  th:first-child{width:31%}th:nth-child(2){width:23%;text-align:right}
  tbody th,td{padding:13px 16px;vertical-align:middle;border-top:1px solid #191719;overflow-wrap:anywhere;line-height:1.5}
  tbody th{font-weight:400;color:${p=>p.theme.colors.text.secondary}}td:nth-child(2){text-align:right;white-space:normal;font-variant-numeric:tabular-nums;color:${p=>p.theme.colors.text.primary}}
  td:last-child{font-size:12px;color:#9c969e}tr[data-section-start]>*{border-top-color:#302a31}tbody tr:hover{background:#0e0b0f}
  @media(max-width:650px){
    thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    &,tbody{display:block}tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(90px,42%);padding:12px;border-top:1px solid #211c23;gap:5px 12px}
    tbody th,td{display:block;width:auto;padding:0;border:0}tbody th:first-child{width:auto}td:nth-child(2){align-self:center}td:last-child{grid-column:1/-1;font-size:11px}
  }
`
const Category=styled.span`display:block;margin-bottom:6px;color:#c6b173;font:10px/1.4 ${p=>p.theme.fonts.mono};letter-spacing:.025em;`
