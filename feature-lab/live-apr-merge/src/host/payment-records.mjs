export const paymentRecordsKey=wallet=>'saffron.creation-payments.v1:'+wallet.toLowerCase()
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const states=['prepared','submitting','submitted','confirming','accepted','needs_attention','confirmed_unpaid','abandoned','refunded']

function checkedNonces(latest,pending){
  if(!Number.isSafeInteger(latest)||latest<0||!Number.isSafeInteger(pending)||pending<latest)
    throw new Error('Wallet transaction state is unavailable. Check again before paying.')
}

/** A saved submission is evidence to recover, never evidence of a mined or
 * pending transaction. Only the chain can advance the next account nonce. */
export function nextPaymentNonce(records,latest,pending){
  checkedNonces(latest,pending)
  if(Object.values(records).some(p=>p.sent&&p.nonce===undefined&&!p.deploymentId))
    throw new Error('Resume the saved payment in Portfolio. Its transaction nonce is missing, so another fee cannot be safely sequenced.')
  const unresolved=Object.values(records).filter(p=>p.sent&&p.nonce!==undefined&&p.nonce>=pending).sort((a,b)=>a.nonce-b.nonce)[0]
  if(unresolved)throw new Error(`Resume the earlier payment at nonce ${unresolved.nonce} from Portfolio before paying for another vault. Its submission is not yet accounted for on the chain.`)
  return pending
}

/** Used only by the explicit same-payment retry action. Even if the original
 * send later arrives, identical terms at the same nonce cannot pay twice. */
export function retryPaymentNonce(payment,latest,pending,now=Date.now()){
  checkedNonces(latest,pending)
  if(!payment.sent||payment.hash||!Number.isSafeInteger(payment.nonce)||payment.nonce<0)
    throw new Error('Check the existing payment transaction instead of submitting it again.')
  if(!Number.isFinite(Date.parse(payment.quote.paymentDeadline))||Date.parse(payment.quote.paymentDeadline)<=now)
    throw new Error(`This quote expired. Resolve nonce ${payment.nonce} in your wallet, then enter its transaction hash here to verify the outcome.`)
  if(latest!==payment.nonce||pending!==payment.nonce)
    throw new Error('The original nonce is occupied or an earlier transaction is unresolved. Check payment discovery or enter the existing transaction hash.')
  return payment.nonce
}

/** One storage write publishes the records and active pointer together. Callers
 * hold the wallet Web Lock; revisions also reject stale async callbacks. */
export function readPayments(storage,wallet){
  const raw=storage.getItem(paymentRecordsKey(wallet))
  if(raw===null)return {revision:0,activeId:null,records:{},draft:null}
  let ledger
  try{ledger=JSON.parse(raw)}catch{throw new Error('Saved payment recovery data is unreadable. Do not pay again.')}
  if(!Number.isSafeInteger(ledger?.revision)||ledger.revision<0||!ledger.records||typeof ledger.records!=='object'||Array.isArray(ledger.records)
    ||Object.entries(ledger.records).some(([id,p])=>!uuid.test(id)||p?.quote?.id!==id||p.quote.wallet!==wallet.toLowerCase()||!states.includes(p.status)||typeof p.sent!=='boolean'||(p.nonce!==undefined&&(!Number.isSafeInteger(p.nonce)||p.nonce<0)))
    ||(ledger.activeId!==null&&!Object.hasOwn(ledger.records,ledger.activeId))
    ||(ledger.draft&&(!uuid.test(ledger.draft.requestKey)||ledger.draft.wallet!==wallet.toLowerCase())))throw new Error('Saved payment recovery data is invalid. Do not pay again.')
  return ledger
}

export function savePayment(storage,wallet,expected,payment,{active=true}={}){
  const latest=readPayments(storage,wallet),id=payment.quote.id,previous=latest.records[id]
  if(latest.revision!==expected.revision)throw new Error('This payment changed in another tab. Resume the saved request.')
  if(!uuid.test(id)||payment.quote.wallet!==wallet.toLowerCase()||!states.includes(payment.status))throw new Error('Invalid payment record.')
  if(previous&&(JSON.stringify(previous.quote)!==JSON.stringify(payment.quote)||previous.recoverySecret!==payment.recoverySecret))throw new Error('Payment terms cannot be overwritten.')
  if(previous?.sent&&payment.status==='abandoned')throw new Error('A submitted payment cannot be discarded.')
  const next={revision:latest.revision+1,activeId:active?id:latest.activeId===id?null:latest.activeId,draft:null,records:{...latest.records,[id]:{...payment,updatedAt:Date.now()}}}
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

/** Select a checkout without deleting any payment recovery record. This pointer
 * is a UI focus, not a limit on simultaneous paid requests. */
export function selectPayment(storage,wallet,expected,id=null){
  const latest=readPayments(storage,wallet)
  if(latest.revision!==expected.revision)throw new Error('Payment selection changed in another tab.')
  if(id!==null&&!Object.hasOwn(latest.records,id))throw new Error('Saved payment not found.')
  const next={...latest,revision:latest.revision+1,activeId:id,draft:null}
  storage.setItem(paymentRecordsKey(wallet),JSON.stringify(next));return next
}
