import { encodeFunctionData,decodeFunctionResult } from 'viem'
import { abi } from '../shared/vault-lifecycle.mjs'
import { fault,validAddress,integer,digest } from '../shared/incentives.mjs'
const s='saffron_incentives',max=(a,b)=>a>b?a:b

/** An allocation is a lifetime spending ceiling. Its unspent portion is set
 * aside in one named treasury holding, even before individual users check out. */
export function createTreasuryInventory(db){return {
  async treasuryBook(client=db){
    return (await client.query(`SELECT a.*,b.reward_asset,b.decimals,b.allocated_raw,b.reserved_raw,b.paused,b.reconciliation_required,
      COALESCE((SELECT sum(q.hold_raw) FROM ${s}.deployment_quotes q WHERE q.budget_pool_id=b.id AND q.hold_state IN ('held','closing')),0)::text held_raw
      FROM ${s}.treasury_allocations a JOIN ${s}.budget_pools b ON b.id=a.budget_pool_id ORDER BY a.budget_pool_id`)).rows
  },
  async assignTreasury(input,actor,evidence){
    if(!validAddress(input.wallet)||!Number.isInteger(input.revision)||input.revision<0||typeof input.reason!=='string'||input.reason.trim().length<8)throw fault(400,'Provide a treasury wallet, revision and allocation reason.')
    integer(input.limitRaw,{positive:true})
    if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.requestKey??''))throw fault(400,'An allocation request key is required.')
    const wallet=input.wallet.toLowerCase(),fingerprint=digest({...input,wallet})
    return db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
      const replay=(await client.query(`SELECT fingerprint,result FROM ${s}.treasury_allocation_audit WHERE actor=$1 AND request_key=$2`,[actor,input.requestKey])).rows[0]
      if(replay){if(replay.fingerprint!==fingerprint)throw fault(409,'Allocation request terms changed.');return replay.result}
      const budget=await db.lockBudget(client,input.budgetId),book=await db.treasuryBook(client),previous=book.find(a=>a.budget_pool_id===budget.id)
      if((previous?.revision??0)!==input.revision)throw fault(409,'Treasury allocation changed. Refresh before editing.')
      if(BigInt(input.limitRaw)<BigInt(budget.allocated_raw)+BigInt(budget.reserved_raw)+await db.rawHolds(client,budget.id))throw fault(409,'The allocation cannot discard spent or outstanding premiums.')
      const holding=wallet+':'+budget.reward_asset
      if(!evidence||db.now()-evidence.checkedAt>15000||evidence.checkedAt>db.now()+5000||allocationIdentity(book)!==evidence.identity||!Object.hasOwn(evidence.balances,holding))throw fault(503,'Fresh treasury inventory evidence is required.')
      const other=book.filter(a=>a.budget_pool_id!==budget.id&&a.wallet===wallet&&a.reward_asset===budget.reward_asset)
        .reduce((sum,a)=>sum+max(0n,BigInt(a.limit_raw)-BigInt(a.allocated_raw)),0n)
      if(other+BigInt(input.limitRaw)-BigInt(budget.allocated_raw)>BigInt(evidence.balances[holding]))throw fault(409,'This treasury holding is insufficient or already assigned to another campaign.')
      const result=(await client.query(`INSERT INTO ${s}.treasury_allocations(budget_pool_id,wallet,limit_raw,revision,updated_by)
        VALUES($1,$2,$3,1,$4) ON CONFLICT(budget_pool_id) DO UPDATE SET wallet=$2,limit_raw=$3,revision=treasury_allocations.revision+1,updated_by=$4,updated_at=NOW() RETURNING *`,[budget.id,wallet,input.limitRaw,actor])).rows[0]
      await client.query(`INSERT INTO ${s}.treasury_allocation_audit(budget_pool_id,actor,request_key,fingerprint,reason,evidence,result) VALUES($1,$2,$3,$4,$5,$6,$7)`,[budget.id,actor,input.requestKey,fingerprint,input.reason.trim(),evidence,result])
      return result
    })
  },
  async requireTreasury(client,budgetId,premium,evidence){
    const book=await db.treasuryBook(client),row=book.find(a=>a.budget_pool_id===budgetId)
    if(!row||!evidence?.available||db.now()-evidence.checkedAt>15000||evidence.checkedAt>db.now()+5000||allocationIdentity(book)!==evidence.identity)throw fault(409,'Treasury allocation or inventory must be verified before payment.')
    if(BigInt(row.allocated_raw)+BigInt(row.reserved_raw)+BigInt(row.held_raw)+BigInt(premium)>BigInt(row.limit_raw))throw fault(409,'The campaign treasury allocation is already committed.')
  },
}}
const allocationIdentity=rows=>digest(rows.map(a=>({budgetId:a.budget_pool_id,wallet:a.wallet,limitRaw:a.limit_raw,allocatedRaw:a.allocated_raw,revision:a.revision})))

/** Read balances at one confirmed block, count each wallet/token holding once,
 * and verify the evidence used to subtract already funded premiums. */
export async function treasuryCoverage({db,rpc,confirmations=2,now=Date.now,extra=[]}){
  const book=await db.treasuryBook(),latest=await rpc('eth_getBlockByNumber',['latest',false])
  if(BigInt(await rpc('eth_chainId',[]))!==4663n||!latest?.hash||now()-Number(BigInt(latest.timestamp))*1000>60000||Number(BigInt(latest.timestamp))*1000>now()+5000)throw fault(503,'Fresh treasury chain evidence is unavailable.')
  const height=BigInt(latest.number)-BigInt(confirmations-1)
  if(height<0n)throw fault(503,'Treasury confirmations are unavailable.')
  const block=await rpc('eth_getBlockByNumber',['0x'+height.toString(16),false]),balances={},holdings=new Map()
  for(const a of [...book,...extra])holdings.set(a.wallet.toLowerCase()+':'+a.reward_asset.toLowerCase(),a)
  for(const [key,a]of holdings){balances[key]=String(decodeFunctionResult({abi,functionName:'balanceOf',data:await rpc('eth_call',[{to:a.reward_asset,data:encodeFunctionData({abi,functionName:'balanceOf',args:[a.wallet]})},block.number])}))}
  for(const {snapshot} of (await db.query(`SELECT o.snapshot FROM ${s}.vault_observations o JOIN ${s}.budget_reservations r ON r.intent_id=o.intent_id WHERE r.allocated_raw>0`)).rows){
    if(!snapshot?.verified||BigInt(snapshot.blockNumber)>height||(await rpc('eth_getBlockByNumber',['0x'+BigInt(snapshot.blockNumber).toString(16),false]))?.hash!==snapshot.blockHash)throw fault(503,'Funded treasury obligations require canonical reconciliation.')
  }
  if((await rpc('eth_getBlockByNumber',[block.number,false]))?.hash!==block.hash)throw fault(503,'Treasury inventory block changed.')
  const rows=book.map(a=>({...a,unspentRaw:max(0n,BigInt(a.limit_raw)-BigInt(a.allocated_raw)).toString(),availableRaw:max(0n,BigInt(a.limit_raw)-BigInt(a.allocated_raw)-BigInt(a.reserved_raw)-BigInt(a.held_raw)).toString()}))
  const insufficient=[]
  for(const key of holdings.keys()){
    const assigned=rows.filter(a=>a.wallet+':'+a.reward_asset===key).reduce((sum,a)=>sum+BigInt(a.unspentRaw),0n)
    if(assigned>BigInt(balances[key]))insufficient.push(key)
  }
  const missing=(await db.query(`SELECT b.id FROM ${s}.budget_pools b WHERE NOT b.paused AND EXISTS(SELECT 1 FROM ${s}.programs p WHERE p.budget_pool_id=b.id AND (p.body->>'active')::boolean)
    AND NOT EXISTS(SELECT 1 FROM ${s}.treasury_allocations a WHERE a.budget_pool_id=b.id)`)).rows.map(a=>a.id)
  return {available:insufficient.length===0&&missing.length===0,missing,insufficient,allocations:rows,balances,identity:allocationIdentity(book),checkedAt:now(),blockNumber:block.number,blockHash:block.hash}
}
