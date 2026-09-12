import { fault,validAddress } from '../shared/incentives.mjs'
const s='saffron_incentives'
export function createIntakePolicy(db){return {
  async intakePolicy(signer){return (await db.query(`SELECT * FROM ${s}.intake_policies WHERE signer=$1`,[signer?.toLowerCase()])).rows[0]??null},
  async saveIntake(input,actor){
    const expiry=Date.parse(input.expiresAt)
    if(!validAddress(input.signer)||!Number.isInteger(input.revision)||!['automatic','reviewed'].includes(input.mode)||typeof input.enabled!=='boolean'
      ||!Number.isFinite(expiry)||expiry<=db.now()||expiry>db.now()+86400_000||!Number.isInteger(input.serviceMinutes)||input.serviceMinutes<1||input.serviceMinutes>1440
      ||!/^[-a-z0-9]{1,64}$/.test(input.watcherId??''))throw fault(400,'Set a bounded intake window, service window and watcher identity.')
    return db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
      const previous=(await client.query(`SELECT revision FROM ${s}.intake_policies WHERE signer=$1 FOR UPDATE`,[input.signer.toLowerCase()])).rows[0]
      if((previous?.revision??0)!==input.revision)throw fault(409,'Intake policy changed. Refresh before saving.')
      const result=(await client.query(`INSERT INTO ${s}.intake_policies(signer,revision,mode,enabled,expires_at,service_minutes,watcher_id,actor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(signer) DO UPDATE SET revision=EXCLUDED.revision,mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,
        expires_at=EXCLUDED.expires_at,service_minutes=EXCLUDED.service_minutes,watcher_id=EXCLUDED.watcher_id,actor=EXCLUDED.actor,updated_at=NOW() RETURNING *`,
        [input.signer.toLowerCase(),input.revision+1,input.mode,input.enabled,new Date(expiry),input.serviceMinutes,input.watcherId,actor])).rows[0]
      await client.query(`INSERT INTO ${s}.intake_audit(signer,actor,policy) VALUES($1,$2,$3)`,[result.signer,actor,result])
      return result
    })
  },
  async requireIntake(client,signer,revision){
    const row=(await client.query(`SELECT * FROM ${s}.intake_policies WHERE signer=$1`,[signer.toLowerCase()])).rows[0]
    if(!row?.enabled||row.revision!==revision||row.expires_at.getTime()<=db.now())throw fault(409,'Intake policy changed before checkout. Refresh offers.')
  },
}}

/** One read-only status contract for catalog, checkout and administration. */
export async function intakeReadiness({db,rpc,signer,confirmations=2,now=Date.now}){
  const policy=await db.intakePolicy(signer),workerOnline=await db.execution.workerOnline(signer),reasons=[]
  const slots=await db.pendingSlots(db,null)
  if(!policy?.enabled)reasons.push('intake_paused')
  else if(policy.expires_at.getTime()<=now())reasons.push('intake_expired')
  if(policy?.mode==='automatic'&&!workerOnline)reasons.push('worker_offline')
  let watcher=null
  if(policy){
    const cursor=(await db.query('SELECT * FROM saffron_incentives.payment_scan_cursors WHERE id=$1',[policy.watcher_id])).rows[0]
    if(!cursor||!cursor.checked_at||now()-cursor.checked_at.getTime()>15_000||cursor.block_number===null)reasons.push('watcher_unavailable')
    else try{
      const [chain,head,block]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_getBlockByNumber',['0x'+BigInt(cursor.block_number).toString(16),false])])
      const lag=BigInt(head.number)-BigInt(confirmations-1)-BigInt(cursor.block_number),headAt=Number(BigInt(head.timestamp))*1000
      watcher={id:cursor.id,blockNumber:cursor.block_number,blockHash:cursor.block_hash,lagBlocks:lag.toString(),checkedAt:cursor.checked_at}
      if(BigInt(chain)!==4663n||block?.hash!==cursor.block_hash||lag<0n)reasons.push('watcher_reconciliation_required')
      else if(lag>32n||now()-headAt>60_000||headAt>now()+5000)reasons.push('watcher_behind')
    }catch{reasons.push('watcher_unavailable')}
  }
  return {canQuote:reasons.length===0,reasons,mode:policy?.mode??'reviewed',policy,workerOnline,watcher,pending:slots.total}
}
