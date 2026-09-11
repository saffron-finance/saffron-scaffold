import { fault } from '../shared/incentives.mjs'
import { legacyGasPrice } from '../worker/gas-policy.mjs'
const s='saffron_incentives',max=(a,b)=>a>b?a:b

/** Reserve the hard ceiling for all three supported factory calls. This is a
 * conservative upper bound, not a forecast from one historical deployment. */
export function creationGasCeiling(config){
  for(const name of ['maxGasPerTx','maxGasPriceWei','maxDailyGasWei'])if(!/^[1-9][0-9]*$/.test(String(config?.[name]??'')))throw fault(503,'Creation gas and subsidy ceilings must be configured.')
  if(!/^(0|[1-9][0-9]*)$/.test(String(config?.maxSubsidyWei??'')))throw fault(503,'Configure a nonnegative creation subsidy ceiling.')
  return 3n*BigInt(config.maxGasPerTx)*BigInt(config.maxGasPriceWei)
}
export function createGasReservations(db){return {
  async gasBook(signer,client=db){
    const rows=(await client.query(`SELECT g.*,q.hold_state,i.id AS intent_id,j.state,
      p.evidence AS payment,o.state AS payment_state,
      COALESCE((SELECT sum(r.amount_wei) FROM ${s}.refund_transfers r WHERE r.payment_hash=p.hash AND r.state='confirmed'),0)::text refunded
      FROM ${s}.gas_reservations g JOIN ${s}.deployment_quotes q ON q.id=g.quote_id
      LEFT JOIN ${s}.deployment_intents i ON i.quote_id=q.id LEFT JOIN ${s}.vault_jobs j ON j.intent_id=i.id
      LEFT JOIN ${s}.payment_proofs p ON p.quote_id=q.id LEFT JOIN ${s}.payment_obligations o ON o.hash=p.hash WHERE g.signer=$1`,[signer.toLowerCase()])).rows
    const txs=(await client.query(`SELECT t.* FROM ${s}.chain_operations t WHERE signer=$1`,[signer.toLowerCase()])).rows
    let exposure=0n,spent=0n,pending=0n,subsidy=0n,revenue=0n,allSpent=0n
    const cutoff=db.now()-86400_000
    for(const row of rows){
      const journal=txs.filter(t=>t.intent_id===row.intent_id)
      const confirmed=journal.filter(t=>t.receipt&&t.receipt_canonical)
      const actual=confirmed.reduce((sum,t)=>sum+BigInt(t.receipt.gasUsed)*BigInt(t.receipt.effectiveGasPrice??t.transaction_data.gasPrice),0n)
      allSpent+=actual
      spent+=confirmed.filter(t=>!t.receipt_time||t.receipt_time.getTime()>cutoff).reduce((sum,t)=>sum+BigInt(t.receipt.gasUsed)*BigInt(t.receipt.effectiveGasPrice??t.transaction_data.gasPrice),0n)
      const unknown=journal.filter(t=>!t.receipt||!t.receipt_canonical).reduce((sum,t)=>sum+BigInt(t.transaction_data.gas)*BigInt(t.transaction_data.gasPrice),0n)
      pending+=unknown
      const settled=row.hold_state==='released'&&!row.intent_id||['created','retired'].includes(row.state)&&confirmed.length===journal.length
      const remaining=settled?0n:max(unknown,max(0n,BigInt(row.maximum_wei)-actual))
      exposure+=remaining
      const received=row.payment?max(0n,BigInt(row.payment.amountWei)-BigInt(row.refunded)):0n
      revenue+=received
      const expectedFee=row.payment_state&&['refund_due','confirming','refunded','reconciliation_required'].includes(row.payment_state)?0n:row.payment?received:BigInt(row.fee_wei)
      if(remaining>0n||confirmed.some(t=>!t.receipt_time||t.receipt_time.getTime()>cutoff))subsidy+=max(0n,actual+remaining-expectedFee)
    }
    return {exposureWei:exposure.toString(),spentWei:spent.toString(),allSpentWei:allSpent.toString(),pendingTxWei:pending.toString(),subsidyWei:subsidy.toString(),feeRevenueWei:revenue.toString()}
  },
  async reserveGas(client,quote,gas){
    if(!gas||db.now()-gas.checkedAt>15_000||gas.checkedAt>db.now()+5000)throw fault(503,'Fresh signer gas coverage is required before payment.')
    const book=await db.gasBook(quote.signer,client),maximum=BigInt(gas.maximumWei),subsidy=max(0n,maximum-BigInt(quote.fee.amountWei))
    if(BigInt(book.exposureWei)+maximum>BigInt(gas.balanceWei)||BigInt(book.exposureWei)+BigInt(book.spentWei)+maximum>BigInt(gas.maxDailyGasWei)
      ||BigInt(book.subsidyWei)+subsidy>BigInt(gas.maxSubsidyWei))throw fault(409,'Signer gas or subsidy capacity is already committed. No creation fee is due.')
    await client.query(`INSERT INTO ${s}.gas_reservations(quote_id,signer,maximum_wei,fee_wei,evidence) VALUES($1,$2,$3,$4,$5)`,[quote.id,quote.signer,gas.maximumWei,quote.fee.amountWei,gas])
  },
  async checkJobGas(client,id,amount){
    const row=(await client.query(`SELECT g.maximum_wei FROM ${s}.gas_reservations g JOIN ${s}.deployment_intents i ON i.quote_id=g.quote_id WHERE i.id=$1`,[id])).rows[0]
    if(!row)throw fault(409,'The request has no creation gas reservation.')
    const costs=(await client.query(`SELECT receipt,receipt_canonical,transaction_data FROM ${s}.chain_operations WHERE intent_id=$1`,[id])).rows
    const used=costs.reduce((sum,t)=>sum+(t.receipt&&t.receipt_canonical?BigInt(t.receipt.gasUsed)*BigInt(t.receipt.effectiveGasPrice??t.transaction_data.gasPrice):BigInt(t.transaction_data.gas)*BigInt(t.transaction_data.gasPrice)),0n)
    if(used+amount>BigInt(row.maximum_wei))throw fault(409,'The original creation gas reservation is exhausted. Operator resolution is required.')
  },
  async reacquireGas(client,quote,gas){
    const original=(await client.query(`SELECT * FROM ${s}.gas_reservations WHERE quote_id=$1`,[quote.id])).rows[0]
    if(!original||!gas||db.now()-gas.checkedAt>15000)throw fault(409,'Fresh gas capacity is required to admit the released original request.')
    const book=await db.gasBook(quote.signer,client),maximum=BigInt(original.maximum_wei),subsidy=max(0n,maximum-BigInt(quote.fee.amountWei))
    if(BigInt(book.exposureWei)+maximum>BigInt(gas.balanceWei)||BigInt(book.exposureWei)+BigInt(book.spentWei)+maximum>BigInt(gas.maxDailyGasWei)
      ||BigInt(book.subsidyWei)+subsidy>BigInt(gas.maxSubsidyWei))throw fault(409,'The original request must wait for sufficient gas and subsidy capacity.')
  },
}}

export async function gasCoverage({db,rpc,config,signer,now=Date.now}){
  const maximumWei=creationGasCeiling(config)
  const [chain,head,suggested]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_gasPrice',[])])
  const headAt=Number(BigInt(head?.timestamp??0))*1000
  if(BigInt(chain)!==4663n||!head?.hash||now()-headAt>60000||headAt>now()+5000)throw fault(503,'Fresh gas chain evidence is unavailable.')
  legacyGasPrice({suggested,baseFee:head.baseFeePerGas??'0x0',maximum:config.maxGasPriceWei})
  // Check every cached gas receipt before allowing its unused ceiling to be
  // reused. An orphan returns to outstanding signed exposure, never zero cost.
  for(const row of (await db.query('SELECT hash,receipt FROM saffron_incentives.chain_operations WHERE signer=$1 AND receipt IS NOT NULL',[signer.toLowerCase()])).rows){
    const canonical=(await rpc('eth_getBlockByNumber',[row.receipt.blockNumber,false]))?.hash===row.receipt.blockHash
    await db.query('UPDATE saffron_incentives.chain_operations SET receipt_canonical=$2 WHERE hash=$1',[row.hash,canonical])
    if(!canonical)throw fault(503,'Creation gas receipt requires reconciliation.')
  }
  for(const row of (await db.query(`SELECT p.evidence FROM saffron_incentives.payment_proofs p JOIN saffron_incentives.gas_reservations g ON g.quote_id=p.quote_id WHERE g.signer=$1`,[signer.toLowerCase()])).rows){
    if(!row.evidence.blockHash||(await rpc('eth_getBlockByNumber',[row.evidence.blockNumber,false]))?.hash!==row.evidence.blockHash)throw fault(503,'Creation fee revenue requires canonical reconciliation.')
  }
  const balanceWei=BigInt(await rpc('eth_getBalance',[signer,head.number])).toString()
  const signerNonce=BigInt(await rpc('eth_getTransactionCount',[signer,head.number])).toString()
  if((await rpc('eth_getBlockByNumber',[head.number,false]))?.hash!==head.hash)throw fault(503,'Gas coverage block changed.')
  return {maximumWei:maximumWei.toString(),balanceWei,signerNonce,checkedAt:now(),blockNumber:head.number,blockHash:head.hash,
    maxDailyGasWei:config.maxDailyGasWei,maxSubsidyWei:config.maxSubsidyWei,book:await db.gasBook(signer)}
}
