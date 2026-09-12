import { FACTORY,CHAIN_ID,fault,digest } from '../shared/incentives.mjs'

const s='saffron_incentives'

/** Private worker journal. HTTP DTOs must never serialize these records directly. */
export function createExecutionDatabase(db) {
  const {query,transaction}=db
  async function lockedJob(client,id,owner) {
    const row=(await client.query(`SELECT * FROM ${s}.vault_jobs WHERE intent_id=$1 AND lease_owner=$2 AND lease_until>NOW() FOR UPDATE`,[id,owner])).rows[0]
    if(!row) throw new Error('Worker job lease lost.')
    return row
  }
  async function requireReservation(id,client={query}) {
    const rows=await client.query(`SELECT 1 FROM ${s}.budget_reservations WHERE intent_id=$1 AND released_raw=premium_raw`,[id])
    if(rows.rowCount)throw fault(409,'This deployment reservation was retired.')
  }
  const execution={
    job:db.getIntent,
    async heartbeat(signer){await query(`INSERT INTO ${s}.worker_heartbeats (signer) VALUES ($1) ON CONFLICT(signer) DO UPDATE SET updated_at=NOW()`,[signer.toLowerCase()])},
    async workerOnline(signer){return Boolean(signer&&(await query(`SELECT 1 FROM ${s}.worker_heartbeats WHERE signer=$1 AND updated_at>NOW()-INTERVAL '15 seconds'`,[signer.toLowerCase()])).rowCount)},
    async signerLock(signer){
      await db.ready;const client=await db.pool.connect()
      const key='saffron-signer:'+signer.toLowerCase()
      if(!(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked){client.release();return null}
      let alive=true;const lost=()=>{alive=false};client.on('error',lost)
      return {assert:async()=>{if(!alive)throw new Error('Signer lock lost.');await client.query('SELECT 1')},
        release:async()=>{client.off('error',lost);try{if(alive)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key])}finally{client.release()}}}
    },
    // A pinned request is mandatory for one-shot operation. NULL retains the
    // ordinary queue worker; an unknown ID must never fall back to another job.
    async claim(signer,owner,requestId=null){
      const row=(await query(`UPDATE ${s}.vault_jobs SET lease_owner=$2,lease_until=NOW()+INTERVAL '60 seconds',
        state='running',updated_at=NOW()
        WHERE intent_id=(SELECT intent_id FROM ${s}.vault_jobs WHERE signer=$1 AND ($3::uuid IS NULL OR intent_id=$3::uuid) AND next_attempt_at<=NOW()
          AND state IN ('queued','running','waiting') AND operation='create'
          AND NOT EXISTS(SELECT 1 FROM ${s}.deployment_intents i WHERE i.id=intent_id AND i.cancel_requested)
          AND (EXISTS(SELECT 1 FROM ${s}.chain_operations t WHERE t.intent_id=${s}.vault_jobs.intent_id)
            OR EXISTS(SELECT 1 FROM ${s}.budget_reservations r WHERE r.intent_id=${s}.vault_jobs.intent_id AND r.released_raw<r.premium_raw))
          AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING intent_id`,[signer.toLowerCase(),owner,requestId])).rows[0]
      return row?db.getIntent(row.intent_id):null
    },
    async renew(id,owner){
      if(!(await query(`UPDATE ${s}.vault_jobs SET lease_until=NOW()+INTERVAL '60 seconds' WHERE intent_id=$1 AND lease_owner=$2 AND lease_until>NOW() RETURNING intent_id`,[id,owner])).rowCount) throw new Error('Worker job lease lost.')
    },
    async authorizeStep(id,owner){
      const job=await db.getIntent(id)
      if(!job || job.lease_owner!==owner || job.lease_until?.getTime()<=db.now() || job.state==='retired') throw new Error('Worker job lease lost.')
      await requireReservation(id)
      const budget=(await query(`SELECT paused,reconciliation_required FROM ${s}.budget_pools WHERE id=$1`,[job.budget_pool_id])).rows[0]
      if(budget?.reconciliation_required) throw fault(409,'Budget reconciliation is required before new transactions.')
      if((budget?.paused || job.cancel_requested)) throw fault(409,job.cancel_requested?'Historical request is stopped; inspect it manually.':'Campaign execution is paused.')
      if(!(await query(`SELECT 1 FROM ${s}.payment_obligations o JOIN ${s}.payment_proofs p ON p.hash=o.hash WHERE p.quote_id=$1 AND o.execution_allowed`,[job.quote_id])).rowCount)throw fault(409,'Payment resolution has stopped creation.')
      if(!(await query(`SELECT 1 FROM ${s}.deployment_quotes q JOIN ${s}.programs p ON p.id=q.program_id JOIN ${s}.pairs a ON a.id=q.body->>'pairId'
        WHERE q.id=$1 AND p.body->>'active'='true' AND a.body->>'active'='true'`,[job.quote_id])).rowCount)throw fault(409,'Campaign execution is paused.')
      if(digest(job.accepted_plan)!==digest(Object.fromEntries(Object.keys(job.accepted_plan).map(key=>[key,job.plan[key]])))) throw fault(409,'The accepted deployment plan changed.')
      return job
    },
    async setPlan(id,owner,plan){await transaction(async client=>{await lockedJob(client,id,owner);await client.query(`UPDATE ${s}.vault_jobs SET plan=$3,updated_at=NOW() WHERE intent_id=$1 AND lease_owner=$2`,[id,owner,plan])})},
    async setState(id,owner,state,error=null){
      await transaction(async client=>{
        const job=await lockedJob(client,id,owner)
        const waiting=state==='waiting'
        const seconds=waiting?Math.min(300,5*2**Math.min(job.attempts,6)):0
        await client.query(`UPDATE ${s}.vault_jobs SET state=$3,error=$4,lease_owner=NULL,lease_until=NULL,
          attempts=CASE WHEN $5 THEN attempts+1 ELSE 0 END,next_attempt_at=NOW()+$6*INTERVAL '1 second',updated_at=NOW()
          WHERE intent_id=$1 AND lease_owner=$2`,[id,owner,state,error,waiting,seconds])
        if(state==='failed') await client.query(`UPDATE ${s}.deployment_intents SET status='needs_attention',updated_at=NOW() WHERE id=$1`,[id])
        if(state==='failed')await client.query(`UPDATE ${s}.payment_obligations SET kind='creation-failure',state='needs_attention',revision=revision+1,updated_at=NOW() WHERE hash=(SELECT p.hash FROM ${s}.payment_proofs p JOIN ${s}.deployment_intents i ON i.quote_id=p.quote_id WHERE i.id=$1) AND state='admitted'`,[id])
      })
    },
    async lastTransaction(id,step){return (await query(`SELECT * FROM ${s}.chain_operations WHERE intent_id=$1 AND step=$2 ORDER BY id DESC LIMIT 1`,[id,step])).rows[0]??null},
    async transactions(id){return(await query(`SELECT * FROM ${s}.chain_operations WHERE intent_id=$1 ORDER BY id`,[id])).rows},
    async transactionMetadata(id){return(await query(`SELECT id,intent_id,step,signer,nonce,resume_version,hash,transaction_data,receipt,resolved_hash,resolution_kind,created_at FROM ${s}.chain_operations WHERE intent_id=$1 ORDER BY id`,[id])).rows},
    async saveTransaction({requestId:id,owner,step,resumeVersion,signer,nonce,hash,raw,transaction:tx}){
      await transaction(async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const intent=(await client.query(`SELECT * FROM ${s}.deployment_intents WHERE id=$1`,[id])).rows[0]
        const budget=await db.lockBudget(client,intent.budget_pool_id)
        const job=await lockedJob(client,id,owner)
        // Recheck under the job/budget locks in case expiry passed during signing.
        // Existing journaled transactions always retain their commitment.
        await requireReservation(id,client)
        const latest=(await client.query(`SELECT cancel_requested FROM ${s}.deployment_intents WHERE id=$1`,[id])).rows[0]
        if(budget.reconciliation_required || (budget.paused||latest.cancel_requested)) throw fault(409,'Execution is paused pending operator review.')
        if(!(await client.query(`SELECT 1 FROM ${s}.payment_obligations o JOIN ${s}.payment_proofs p ON p.hash=o.hash WHERE p.quote_id=$1 AND o.execution_allowed`,[intent.quote_id])).rowCount)throw fault(409,'Payment resolution has stopped creation.')
        const quote=(await client.query(`SELECT body FROM ${s}.deployment_quotes WHERE id=$1`,[intent.quote_id])).rows[0]?.body
        if(!quote||digest(intent.snapshot)!==digest(quote.snapshot)||digest(intent.accepted_plan)!==digest(quote.plan)
          ||digest(intent.accepted_plan)!==digest(Object.fromEntries(Object.keys(intent.accepted_plan).map(key=>[key,job.plan[key]])))) throw fault(409,'The accepted deployment plan changed.')
        await client.query(`INSERT INTO ${s}.chain_operations (intent_id,step,resume_version,signer,nonce,hash,raw_tx,transaction_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id,step,resumeVersion,signer.toLowerCase(),String(nonce),hash,raw,tx])
      })
    },
    async saveReceipt(hash,receipt,timestamp){await query(`UPDATE ${s}.chain_operations SET receipt=$2,receipt_canonical=TRUE,receipt_time=$3 WHERE hash=$1`,[hash,receipt,new Date(timestamp?Number(BigInt(timestamp))*1000:db.now())])},
    async resolveTransaction(id,original,hash,receipt,kind,actor){
      await transaction(async client=>{
        const job=(await client.query(`SELECT * FROM ${s}.vault_jobs WHERE intent_id=$1 FOR UPDATE`,[id])).rows[0]
        if(!job||job.lease_until>new Date(db.now()))throw fault(409,'Wait for the current worker lease to finish.')
        const saved=(await client.query(`UPDATE ${s}.chain_operations SET resolved_hash=$3,receipt=$4,resolution_kind=$5,receipt_canonical=TRUE,receipt_time=NOW() WHERE intent_id=$1 AND hash=$2 RETURNING id`,[id,original,hash,receipt,kind])).rows[0]
        if(!saved)throw fault(404,'Saved transaction not found.')
        const intent=await db.getIntent(id,client)
        await db.entry(client,{budgetId:intent.budget_pool_id,intentId:id,kind:'transaction-reconciled',actor,evidence:{originalHash:original,hash,kind,blockHash:receipt.blockHash}})
      })
    },
    async markCreated(id,owner,snapshot){
      if(!snapshot?.verified||!snapshot.initialized) throw new Error('Creation verification failed.')
      await transaction(async client=>{
        const job=await lockedJob(client,id,owner)
        if(job.plan.vault?.toLowerCase()!==snapshot.vault?.toLowerCase()) throw new Error('Creation identity changed.')
        await client.query(`UPDATE ${s}.vault_jobs SET state='created',operation='observe',lease_owner=NULL,lease_until=NULL,error=NULL,attempts=0,updated_at=NOW() WHERE intent_id=$1`,[id])
        await client.query(`UPDATE ${s}.deployment_intents SET status='created',updated_at=NOW() WHERE id=$1`,[id])
      })
      await execution.saveObservation(id,snapshot)
    },
    async saveObservation(id,snapshot){
      await transaction(async client=>{
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['saffron-observation:'+id])
        const previous=(await client.query(`SELECT snapshot FROM ${s}.vault_observations WHERE intent_id=$1`,[id])).rows[0]?.snapshot
        if(previous?.checkedAt>snapshot.checkedAt)return
        // Publish accounting and its evidence together across API/worker processes.
        // A newer verified observation may have a lower height after a reorg.
        // Keeping the previous height would leave orphaned funding depositable.
        if(snapshot.verified&&(!previous?.verified||snapshot.variableSupply!==previous.variableSupply||snapshot.isStarted!==previous.isStarted))
          await client.query(`UPDATE ${s}.vault_jobs SET funding_observed_at=$2 WHERE intent_id=$1`,[id,new Date(snapshot.checkedAt)])
        if(!Object.hasOwn(snapshot,'positionScan')&&previous?.positionScan){
          snapshot={positionScan:previous.positionScan,positionOwners:previous.positionOwners,positionsComplete:previous.positionsComplete,...snapshot}
        }
        await db.reconcileFunding(id,snapshot,'observer',client)
        await client.query(`INSERT INTO ${s}.vault_observations (intent_id,snapshot) VALUES ($1,$2) ON CONFLICT(intent_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=NOW()`,[id,snapshot])
      })
    },
    async observation(id){return(await query(`SELECT snapshot FROM ${s}.vault_observations WHERE intent_id=$1`,[id])).rows[0]?.snapshot??null},
    async tracked(){return(await query(`SELECT intent_id FROM ${s}.vault_jobs WHERE plan ? 'vault' ORDER BY updated_at`)).rows},
    async approveOperation(id,operator,planHash,operation){
      if(operation!=='resume')throw fault(400,'Unsupported worker operation.')
      const current=await db.getIntent(id);if(!current||current.plan_hash!==planHash)throw fault(409,'Refresh this deployment before continuing.')
      await transaction(async client=>{
        await db.lockBudget(client,current.budget_pool_id)
        const job=(await client.query(`SELECT * FROM ${s}.vault_jobs WHERE intent_id=$1 FOR UPDATE`,[id])).rows[0]
        if(job.operation!=='create'||current.cancel_requested||job.state==='retired'||job.lease_until>new Date(db.now()))throw fault(409,'The worker must finish reconciling its current action.')
        if(!(await client.query(`SELECT 1 FROM ${s}.payment_obligations o JOIN ${s}.payment_proofs p ON p.hash=o.hash WHERE p.quote_id=$1 AND o.execution_allowed`,[current.quote_id])).rowCount)throw fault(409,'Payment resolution has stopped creation.')
        if(operation==='resume'&&!['failed','waiting'].includes(job.state))throw fault(409,'This deployment does not need a resume.')
        await client.query(`UPDATE ${s}.vault_jobs SET operation=$2,state='queued',operation_actor=$3,resume_version=resume_version+1,
          error=NULL,attempts=0,next_attempt_at=NOW(),updated_at=NOW() WHERE intent_id=$1`,
          [id,job.operation,operator])
      })
    },
  }
  return execution
}
