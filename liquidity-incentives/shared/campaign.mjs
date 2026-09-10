import { parseUnits, formatUnits } from 'viem'

const YEAR = 365n
const ceil = (a,b) => (a+b-1n)/b
const money = value => {
  if(typeof value!=='string'||!/^\d+(\.\d{1,2})?$/.test(value))throw new Error('Enter a positive USD amount with at most two decimals.')
  const result=parseUnits(value,2)
  if(result<=0n||result>100_000_000_000_000n)throw new Error('Campaign amount is outside supported limits.')
  return result
}

/** Resolve exactly two campaign economics inputs after duration is selected.
 * APR is a simple annual percentage on a 365-day year, not compounded APY.
 * Preserve the budget/capacity ratio; display rounding never changes obligations.
 */
export function campaignTerms({days,budgetUsd,capacityUsd,aprPercent}){
  if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Choose a whole campaign duration from 1 to 3650 days.')
  const entries=[budgetUsd,capacityUsd,aprPercent].filter(value=>value!==undefined&&value!==null&&value!=='')
  if(entries.length!==2)throw new Error('Enter exactly two of budget, target capacity and target APR.')
  let budget=budgetUsd?money(budgetUsd):null,capacity=capacityUsd?money(capacityUsd):null
  let apr=null
  if(aprPercent){
    if(typeof aprPercent!=='string'||!/^\d+(\.\d{1,8})?$/.test(aprPercent))throw new Error('Enter APR with at most eight decimal places.')
    apr=parseUnits(aprPercent,8)
    if(apr<=0n||apr>100_000n*10n**8n)throw new Error('APR must be positive and at most 100,000%.')
  }
  // Round funding up and supportable capacity down; never promise an unfunded cent.
  if(budget===null)budget=ceil(capacity*apr*BigInt(days),100n*10n**8n*YEAR)
  if(capacity===null)capacity=budget*100n*10n**8n*YEAR/(apr*BigInt(days))
  if(budget>100_000_000_000_000n||capacity>100_000_000_000_000n)throw new Error('Derived campaign amount is outside supported limits.')
  if(!budget||!capacity)throw new Error('The inputs produce less than one cent of budget or capacity.')
  const aprRaw=budget*YEAR*10n**18n/(capacity*BigInt(days))
  return {days,budgetCents:budget.toString(),capacityCents:capacity.toString(),aprRaw:aprRaw.toString(),
    aprPercent:formatUnits(aprRaw*100n,18),basis:'simple-365',inputs:{budgetUsd:budgetUsd??'',capacityUsd:capacityUsd??'',aprPercent:aprPercent??''}}
}

/** The reservation is an request-time USD commitment, not a live token mark. */
export function campaignPremiumCents(campaign,principalCents){
  return ceil(BigInt(principalCents)*BigInt(campaign.budgetCents),BigInt(campaign.capacityCents)).toString()
}
