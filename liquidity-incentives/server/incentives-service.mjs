import { resolvePlan } from '../shared/deployment-plan.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { eligibility,sameAddress } from '../shared/vault-lifecycle.mjs'
import { cents,snapshotFor,fault,jsonSafe,validAddress } from '../shared/incentives.mjs'
import { userActionEvidence } from '../shared/user-evidence.mjs'

/** Read-only sizing/observation service; the separate worker owns all signing. */
export function createIncentivesService({database:db,rpc,usdQuote,config,signer,origin,now=Date.now}) {
  const pending=new Map()
  let polling=false
  async function refresh(id){
    if(pending.has(id))return pending.get(id)
    const operation=(async()=>{
      const job=await db.getIntent(id)
      if(!job?.plan.vault)return null
      let observation
      try{observation=await readVault(job,rpc,{confirmations:config?.confirmations??2,now})}
      catch{observation={verified:false,canonical:false,checkedAt:now(),reason:'Checking availability'}}
      await db.execution.saveObservation(id,observation)
      for(const record of (await db.query('SELECT hash,receipt FROM saffron_incentives.user_operations WHERE intent_id=$1',[id])).rows){
        let canonical=false
        try{canonical=(await rpc('eth_getBlockByNumber',[record.receipt.blockNumber,false]))?.hash===record.receipt.blockHash}catch{}
        await db.query('UPDATE saffron_incentives.user_operations SET canonical=$2 WHERE hash=$1',[record.hash,canonical])
      }
      return observation
    })().finally(()=>pending.delete(id))
    pending.set(id,operation);return operation
  }
  function requireConfigured(){
    if(!validAddress(signer)||!config?.factoryCodeHash||!config?.vaultTypeHash||!config?.adapterTypeHash||!config?.maxPremiumRaw||!origin) throw fault(503,'Deployment is not configured yet.')
  }
  async function size(offer,principalCents,wallet){
    requireConfigured()
    const snapshot=snapshotFor(offer,principalCents,wallet)
    const plan=await resolvePlan({snapshot},rpc,usdQuote,config)
    return plan
  }
  const service={
    refresh,
    async auditReleases(budgetId,operator){
      const rows=(await db.query(`SELECT DISTINCT ON(e.intent_id) e.intent_id,e.evidence FROM saffron_incentives.budget_entries e
        JOIN saffron_incentives.budget_reservations r ON r.intent_id=e.intent_id
        WHERE e.budget_pool_id=$1 AND e.kind='release-recovered' AND r.released_raw>0 ORDER BY e.intent_id,e.id DESC`,[budgetId])).rows
      let valid=true
      for(const row of rows){
        const proofs=(await db.execution.transactions(row.intent_id)).map(tx=>tx.receipt).filter(Boolean)
        if(row.evidence?.blockHash)proofs.push({blockNumber:'0x'+BigInt(row.evidence.blockNumber).toString(16),blockHash:row.evidence.blockHash})
        let canonical=true
        for(const proof of proofs){
          try{if((await rpc('eth_getBlockByNumber',[proof.blockNumber,false]))?.hash!==proof.blockHash)canonical=false}
          catch{canonical=false}
        }
        if(!canonical){
          valid=false
          await db.query('UPDATE saffron_incentives.budget_pools SET reconciliation_required=TRUE WHERE id=$1',[budgetId])
          // Explicit operator reconciliation restores the obligation first. The
          // worker then resolves saved transactions and proves retirement again.
          if(operator)await db.execution.restoreReleased(row.intent_id,operator)
        }
      }
      return valid
    },
    async reconcileBudget(id,operator){
      await service.auditReleases(id,operator)
      const result=await db.auditBudget(id)
      if(!result.valid)throw fault(409,'Ledger totals differ. Repair the accounting evidence before resuming this campaign.')
      await db.query('UPDATE saffron_incentives.budget_pools SET reconciliation_required=FALSE,paused=TRUE,revision=revision+1,updated_by=$2 WHERE id=$1',[id,operator])
      return (await db.catalog(true)).budgets.find(row=>row.id===id)
    },
    async programs(){
      const {offers}=await db.catalog()
      const rows=[]
      // Small bounded batches; a failed price read leaves an explicit unavailable size.
      for(let start=0;start<offers.length;start+=4) rows.push(...await Promise.all(offers.slice(start,start+4).map(async offer=>{
        if(offer.budget.paused||offer.budget.reconciliationRequired||offer.budget.availableRaw==='0')return {...offer,eligibleMaximumCents:'0',availability:'Campaign funding is unavailable'}
        try{
          const plan=await size(offer,offer.minimumCents,signer)
          const aprRaw=BigInt(snapshotFor(offer,offer.minimumCents,signer).aprRaw)
          const budget=BigInt(offer.budget.availableRaw)<BigInt(config.maxPremiumRaw)?BigInt(offer.budget.availableRaw):BigInt(config.maxPremiumRaw)
          const maximum=budget*10n**18n*31_536_000n*BigInt(plan.variablePrice)/(10n**16n*aprRaw*BigInt(offer.days*86400)*10n**BigInt(plan.variableDecimals))
          const eligible=maximum<BigInt(offer.maximumCents)?maximum:BigInt(offer.maximumCents)
          return {...offer,eligibleMaximumCents:eligible<BigInt(offer.minimumCents)?'0':eligible.toString(),availability:null}
        }catch{return {...offer,eligibleMaximumCents:null,availability:'Live sizing is unavailable'}}
      })))
      return {offers:rows,creatorOnline:await db.execution.workerOnline(signer)}
    },
    async quote(wallet,programId,amount){
      requireConfigured()
      if(!await db.execution.workerOnline(signer))throw fault(503,'The deployment worker is offline. Retry shortly.')
      const principalCents=cents(amount),offer=await db.offer(programId)
      if(BigInt(principalCents)<BigInt(offer.minimumCents)||BigInt(principalCents)>BigInt(offer.maximumCents))throw fault(400,'Choose an amount within the program\'s vault size limits.')
      const plan=await size(offer,principalCents,wallet)
      return db.putQuote({offer,principalCents,wallet,origin,plan,signer})
    },
    async describe(job){
      const observation=await db.execution.observation(job.id)
      const eligible=eligibility(observation,now())
      let state=job.state==='failed'?'needs_attention':job.state==='created'?'checking':job.state==='retired'?'retired':job.state==='queued'?'queued':'deploying'
      let depositable=false,canClaim=false,canWithdraw=false,canRecover=false
      const fresh=eligible.state!=='checking'
      if(job.state==='created'&&fresh){
        if(observation.isStarted){
          canClaim=BigInt(observation.claimBalance)>0n
          const owned=canClaim||BigInt(observation.fixedBalance)>0n
          const matured=BigInt(observation.blockTimestamp)>BigInt(observation.endTime)
          canWithdraw=matured&&BigInt(observation.fixedBalance)>0n
          state=owned?(matured?'matured':canClaim?'claimable':'active'):'no_position'
          if(!owned&&BigInt(observation.adapterLiquidity??'0')===0n&&(await db.query("SELECT 1 FROM saffron_incentives.user_operations WHERE intent_id=$1 AND wallet=$2 AND action='withdraw' AND canonical=TRUE LIMIT 1",[job.id,job.wallet])).rowCount)state='completed'
        }else if(BigInt(observation.claimSupply)>0n){
          canRecover=BigInt(observation.claimBalance)>0n
          state=canRecover?'fixed_awaiting_funding':'occupied'
        }else{state=eligible.state;depositable=eligible.depositable}
      }
      if(job.cancel_requested&&job.state!=='retired'&&!observation?.isStarted){state='retirement_requested';depositable=false}
      const transactions=(await db.execution.transactions(job.id)).map(tx=>({hash:tx.resolved_hash??tx.hash,originalHash:tx.hash,step:tx.step,nonce:String(tx.nonce),confirmed:tx.receipt?.status==='0x1'&&tx.resolution_kind!=='cancelled',reverted:tx.receipt?.status==='0x0'||tx.resolution_kind==='cancelled'}))
      return jsonSafe({id:job.id,wallet:job.wallet,programId:job.snapshot.programId,createdAt:job.created_at,planHash:job.plan_hash,plan:job.plan,
        snapshot:job.snapshot,signer:job.signer,observation,state,depositable,canClaim,canWithdraw,canRecover,
        workerState:job.state,fundingState:job.funding_state,cancelRequested:job.cancel_requested,error:job.error,transactions,
        nextAttemptAt:job.next_attempt_at,fundingOperator:job.funding_operator})
    },
    async detail(id,wallet,admin=false,{fresh=true}={}){
      let job=await db.getIntent(id)
      if(!job||(!admin&&job.wallet!==wallet.toLowerCase()))throw fault(404,'Deployment not found for this wallet.')
      if(fresh&&job.plan.vault)await refresh(id)
      job=await db.getIntent(id)
      return service.describe(job)
    },
    async list(wallet,admin=false){return {deployments:await Promise.all((await db.list({wallet,admin})).map(job=>service.describe(job))),creatorOnline:await db.execution.workerOnline(signer)}},
    async context(id,wallet){
      const deployment=await service.detail(id,wallet)
      return {deployment,job:{plan:deployment.plan,signer:deployment.signer,snapshot:deployment.snapshot,wallet:deployment.wallet},snapshot:deployment.observation}
    },
    async recordUserAction(id,wallet,hash){
      if(!/^0x[0-9a-f]{64}$/i.test(hash??''))throw fault(400,'Provide a transaction hash.')
      const deployment=await service.detail(id,wallet)
      const [receipt,transaction,head,chain]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_blockNumber',[]),rpc('eth_chainId',[])])
      if(BigInt(chain)!==4663n||!receipt||!transaction||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()
        ||BigInt(head)<BigInt(receipt.blockNumber)+BigInt((config?.confirmations??2)-1)
        ||(await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash)throw fault(409,'Transaction confirmations are not available yet.')
      let action
      try{action=userActionEvidence({receipt,transaction,job:deployment})}catch(error){throw fault(409,error.message)}
      await db.query(`INSERT INTO saffron_incentives.user_operations(hash,intent_id,wallet,action,receipt) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(hash) DO UPDATE SET receipt=EXCLUDED.receipt,canonical=TRUE`,[hash.toLowerCase(),id,wallet.toLowerCase(),action,receipt])
      return {action,deployment:await service.detail(id,wallet,false,{fresh:false})}
    },
    async reconcileTransaction(id,operator,original,hash){
      if(![original,hash].every(value=>/^0x[0-9a-f]{64}$/i.test(value??'')))throw fault(400,'Provide the saved and replacement transaction hashes.')
      const job=await db.getIntent(id),tx=(await db.execution.transactions(id)).find(row=>row.hash.toLowerCase()===original.toLowerCase())
      if(!job||!tx)throw fault(404,'Saved transaction not found.')
      const [receipt,mined,head,chain]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_blockNumber',[]),rpc('eth_chainId',[])])
      if(BigInt(chain)!==4663n||!receipt||!mined||!sameAddress(mined.from,job.signer)||BigInt(mined.nonce)!==BigInt(tx.nonce)
        ||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||BigInt(head)<BigInt(receipt.blockNumber)+BigInt((config?.confirmations??2)-1)
        ||(await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash)throw fault(409,'Canonical replacement confirmation is not available.')
      const action=sameAddress(mined.to,tx.transaction_data.to)&&mined.input===tx.transaction_data.data&&BigInt(mined.value)===BigInt(tx.transaction_data.value)
      const cancellation=sameAddress(mined.to,job.signer)&&mined.input==='0x'&&BigInt(mined.value)===0n&&receipt.status==='0x1'
      if(!action&&!cancellation)throw fault(409,'Replacement does not match the saved action or a zero-value self cancellation.')
      await db.execution.resolveTransaction(id,tx.hash,hash.toLowerCase(),receipt,action?'repriced':'cancelled',operator)
    },
    async fund(id,operator,planHash,maximum){
      const deployment=await service.detail(id,operator,true)
      if(!deployment.observation?.verified||deployment.observation.isStarted||deployment.cancelRequested)throw fault(409,'Vault funding is not currently available.')
      await db.execution.approveFunding(id,operator,planHash,maximum)
    },
    async poll(){
      if(polling)return;polling=true
      try{
        await db.execution.expireQueued()
        const jobs=await db.execution.tracked();let index=0
        await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(index<jobs.length)await refresh(jobs[index++].intent_id)}))
        for(const budget of (await db.catalog(true)).budgets){await db.auditBudget(budget.id);await service.auditReleases(budget.id)}
      }finally{polling=false}
    },
  }
  return service
}
