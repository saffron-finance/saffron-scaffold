export const paymentRecordsKey=wallet=>'saffron.creation-payments.v1:'+wallet.toLowerCase()
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const states=['prepared','submitting','submitted','confirming','accepted','needs_attention','confirmed_unpaid','abandoned','refunded']

/** One storage write publishes the records and active pointer together. Callers
 * hold the wallet Web Lock; revisions also reject stale async callbacks. */
export function readPayments(storage,wallet){
  const raw=storage.getItem(paymentRecordsKey(wallet))
  if(raw===null)return {revision:0,activeId:null,records:{},draft:null}
  let ledger
  try{ledger=JSON.parse(raw)}catch{throw new Error('Saved payment recovery data is unreadable. Do not pay again.')}
  if(!Number.isSafeInteger(ledger?.revision)||ledger.revision<0||!ledger.records||typeof ledger.records!=='object'||Array.isArray(ledger.records)
    ||Object.entries(ledger.records).some(([id,p])=>!uuid.test(id)||p?.quote?.id!==id||p.quote.wallet!==wallet.toLowerCase()||!states.includes(p.status)||typeof p.sent!=='boolean')
    ||(ledger.activeId!==null&&!Object.hasOwn(ledger.records,ledger.activeId))
    ||(ledger.draft&&(!uuid.test(ledger.draft.requestKey)||ledger.draft.wallet!==wallet.toLowerCase())))throw new Error('Saved payment recovery data is invalid. Do not pay again.')
  return ledger
}

export function savePayment(storage,wallet,expected,payment,{active=true}={}){
  const latest=readPayments(storage,wallet),id=payment.quote.id,previous=latest.records[id]
  if(latest.revision!==expected.revision)throw new Error('This payment changed in another tab. Resume the saved request.')
  if(!uuid.test(id)||payment.quote.wallet!==wallet.toLowerCase()||!states.includes(payment.status))throw new Error('Invalid payment record.')
  if(previous&&(JSON.stringify(previous.quote)!==JSON.stringify(payment.quote)||previous.recoverySecret!==payment.recoverySecret))throw new Error('Payment terms cannot be overwritten.')
  if(latest.activeId&&latest.activeId!==id)throw new Error('Finish the saved payment before starting another request.')
  if(!active&&!['accepted','abandoned','refunded'].includes(payment.status))throw new Error('An unresolved payment must remain recoverable.')
  if(previous?.sent&&payment.status==='abandoned')throw new Error('A submitted payment cannot be discarded.')
  const next={revision:latest.revision+1,activeId:active?id:null,draft:null,records:{...latest.records,[id]:{...payment,updatedAt:Date.now()}}}
  storage.setItem(paymentRecordsKey(wallet),JSON.stringify(next))
  return next
}

export function saveCheckoutDraft(storage,wallet,expected,draft){
  const latest=readPayments(storage,wallet)
  if(latest.revision!==expected.revision||latest.activeId)throw new Error('Resume the current payment before changing checkout.')
  if(draft&&(!uuid.test(draft.requestKey)||draft.wallet!==wallet.toLowerCase()))throw new Error('Invalid checkout draft.')
  const next={...latest,revision:latest.revision+1,draft}
  storage.setItem(paymentRecordsKey(wallet),JSON.stringify(next));return next
}
