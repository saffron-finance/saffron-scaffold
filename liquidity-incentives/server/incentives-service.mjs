import { verifyPayment, paymentData,proofHash } from './payment-proof.mjs'
import { ceilDiv } from '../shared/liquidity-math.mjs'
import { WETH } from '../shared/vault-lifecycle.mjs'
import { resolvePlan } from '../shared/deployment-plan.mjs'
import { readVault,readPosition } from '../shared/vault-reader.mjs'
import { discoverPositionOwners } from './position-discovery.mjs'
import { eligibility,sameAddress } from '../shared/vault-lifecycle.mjs'
import { cents,snapshotFor,fault,jsonSafe,validAddress,UINT256_MAX } from '../shared/incentives.mjs'
import { userActionEvidence } from '../shared/user-evidence.mjs'

const ownsPosition=row=>row.observation?.verified&&(BigInt(row.observation.claimBalance)>0n||BigInt(row.observation.fixedBalance)>0n)

/** Read-only sizing/observation service; the separate worker owns all signing. */
export function createIncentivesService({database:db,rpc,usdQuote,config,signer,origin,feeRecipient,now=Date.now}) {
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
      if(observation.verified){
        const previous=await db.execution.observation(id)
        try{Object.assign(observation,await discoverPositionOwners(observation,previous,await db.execution.transactionMetadata(id),rpc))}
        catch{Object.assign(observation,{positionScan:previous?.positionScan??null,positionOwners:previous?.positionOwners??[],positionsComplete:false})}
      }
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
  async function size(offer,principalCents,wallet,probe=false){
    requireConfigured()
    const snapshot=snapshotFor(offer,principalCents,wallet)
    const plan=await resolvePlan({snapshot},rpc,usdQuote,probe?{...config,maxPremiumRaw:UINT256_MAX.toString()}:config)
    return plan
  }
  const service={
    refresh,
    async operatorStatus(){
      let gasBalanceRaw=null
      try{if(validAddress(signer))gasBalanceRaw=BigInt(await rpc('eth_getBalance',[signer,'latest'])).toString()}catch{}
      const backlog=(await db.query(`SELECT count(*) FILTER(WHERE state NOT IN ('created','retired') OR funding_state IN ('queued','running','waiting','failed'))::int AS pending,
        count(*) FILTER(WHERE (state NOT IN ('created','retired') OR funding_state IN ('queued','running','waiting','failed')) AND created_at<NOW()-INTERVAL '24 hours')::int AS stalled
        FROM saffron_incentives.vault_jobs`)).rows[0]
      return {signer,gasBalanceRaw,...backlog,workerOnline:await db.execution.workerOnline(signer)}
    },
    async auditReleases(budgetId,operator){
      const rows=(await db.query(`SELECT DISTINCT ON(e.intent_id) e.intent_id,e.evidence FROM saffron_incentives.budget_entries e
        JOIN saffron_incentives.budget_reservations r ON r.intent_id=e.intent_id
        WHERE e.budget_pool_id=$1 AND e.kind='release-recovered' AND r.released_raw>0 ORDER BY e.intent_id,e.id DESC`,[budgetId])).rows
      let valid=true
      for(const row of rows){
        const proofs=(await db.execution.transactionMetadata(row.intent_id)).map(tx=>tx.receipt).filter(Boolean)
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
        if(offer.budget.campaign){
          const a=offer.budget.accounting
          const byBudget=BigInt(a.availableBudgetCents)*BigInt(offer.budget.campaign.capacityCents)/BigInt(offer.budget.campaign.budgetCents)
          const capacity=BigInt(a.availableCapacityCents)<byBudget?BigInt(a.availableCapacityCents):byBudget
          const limit=capacity<BigInt(offer.maximumCents)?capacity:BigInt(offer.maximumCents)
          return {...offer,eligibleMaximumCents:limit<BigInt(offer.minimumCents)?'0':limit.toString(),availability:null}
        }
        try{
          const plan=await size(offer,offer.minimumCents,signer,true)
          const aprRaw=BigInt(snapshotFor(offer,offer.minimumCents,signer).aprRaw)
          const budget=BigInt(offer.budget.availableRaw)<BigInt(config.maxPremiumRaw)?BigInt(offer.budget.availableRaw):BigInt(config.maxPremiumRaw)
          const maximum=budget*10n**18n*31_536_000n*BigInt(plan.variablePrice)/(10n**16n*aprRaw*BigInt(offer.days*86400)*10n**BigInt(plan.variableDecimals))
          const eligible=maximum<BigInt(offer.maximumCents)?maximum:BigInt(offer.maximumCents)
          return {...offer,eligibleMaximumCents:eligible<BigInt(offer.minimumCents)?'0':eligible.toString(),availability:null}
        }catch{return {...offer,eligibleMaximumCents:null,availability:'Live sizing is unavailable'}}
      })))
      return {offers:rows,creatorOnline:await db.execution.workerOnline(signer)}
    },
    async quote(wallet,programId,amount,recoveryHash){
      requireConfigured()
      if(!await db.execution.workerOnline(signer))throw fault(503,'The deployment worker is offline. Retry shortly.')
      const principalCents=cents(amount),offer=await db.offer(programId)
      if(BigInt(principalCents)<BigInt(offer.minimumCents)||BigInt(principalCents)>BigInt(offer.maximumCents))throw fault(400,'Choose an amount within the program\'s vault size limits.')
      const plan=await size(offer,principalCents,wallet)
      if(!validAddress(feeRecipient))throw fault(503,'The ETH creation-fee recipient is not configured.')
      if(sameAddress(wallet,feeRecipient))throw fault(400,'The creation fee receiver cannot request a vault by paying itself.')
      if(typeof recoveryHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(recoveryHash))throw fault(400,'A request recovery commitment is required.')
      const eth=await usdQuote(WETH)
      if(!eth?.priceRaw||BigInt(eth.priceRaw)<=0n||!Number.isFinite(eth.checkedAt)||now()-eth.checkedAt>60_000||eth.checkedAt>now()+5000)throw fault(503,'A fresh ETH/USD fee quote is unavailable.')
      const fee={usdCents:'200',asset:'ETH',recipient:feeRecipient.toLowerCase(),
        amountWei:ceilDiv(2n*10n**36n,BigInt(eth.priceRaw)).toString(),ethPriceRaw:eth.priceRaw,checkedAt:eth.checkedAt}
      const quote=await db.putQuote({offer,principalCents,wallet,origin,plan,signer,fee,recoveryHash})
      return {...quote,paymentData:paymentData(quote)}
    },
    /** Verify the payment chain evidence before admitting exactly one creation.
     * Keep confirmed but blocked payments for operator resolution; never prompt
     * the user to pay again because a response or later capacity check failed.
     */
    async recoverPayment(quoteId,recoverySecret){
      const quote=await db.quote(quoteId)
      if(!quote||typeof recoverySecret!=='string'||!/^0x[0-9a-f]{64}$/i.test(recoverySecret)||proofHash(recoverySecret)!==quote.recoveryHash)throw fault(403,'Request recovery record is required.')
      const payment=(await db.query('SELECT hash,state FROM saffron_incentives.payment_proofs WHERE quote_id=$1',[quoteId])).rows[0]
      if(!payment)return {state:'discovering'}
      await service.paymentProof(quoteId,payment.hash,recoverySecret)
      const intent=(await db.query('SELECT id FROM saffron_incentives.deployment_intents WHERE quote_id=$1',[quoteId])).rows[0]
      return {state:payment.state,paymentHash:payment.hash,wallet:quote.wallet,...(intent?{deployment:await service.detail(intent.id,quote.wallet,false,{fresh:false})}:{})}
    },
    async paymentProof(quoteId,paymentHash,recoverySecret){
      const quote=await db.quote(quoteId)
      if(!quote)throw fault(404,'Payment quote not found.')
      return verifyPayment(quote,paymentHash,recoverySecret,rpc,{confirmations:config?.confirmations??2})
    },
    async acceptPayment(quoteId,paymentHash,recoverySecret){
      const payment=await service.paymentProof(quoteId,paymentHash,recoverySecret)
      try{return {...await db.acceptDeployment({wallet:payment.wallet,quoteId,payment,origin}),wallet:payment.wallet}}
      catch(error){
        await db.query('UPDATE saffron_incentives.payment_proofs SET state=$2,error=$3 WHERE hash=$1',
          [payment.hash,'needs_attention','Confirmed payment is awaiting capacity/policy resolution.'])
        throw fault(409,'Payment confirmed, but creation needs operator resolution. Your payment is saved; do not pay again.')
      }
    },
    async describe(job,wallet=job.wallet){
      let observation=await db.execution.observation(job.id)
      if(observation&&!sameAddress(observation.positionWallet,wallet)){
        try{
          if(eligibility(observation,now()).state==='checking')throw new Error('Position observation unavailable.')
          observation=await readPosition(observation,wallet,rpc)
        }catch{observation={verified:false,canonical:false,checkedAt:now(),positionWallet:wallet,reason:'Checking position ownership'}}
      }
      const isRequester=sameAddress(job.wallet,wallet)
      const eligible=eligibility(observation,now())
      let state=job.state==='failed'?'needs_attention':job.state==='created'?'checking':job.state==='retired'?'retired':job.state==='queued'?'queued':'deploying'
      if(!['created','retired'].includes(job.state)&&now()-job.created_at.getTime()>24*60*60_000)state='needs_attention'
      let depositable=false,canClaim=false,canWithdraw=false,canRecover=false
      const fresh=eligible.state!=='checking'
      // Position ownership survives failed or queued operator work. Only new
      // deposits depend on the creation job having completed successfully.
      if(fresh){
        if(observation.isStarted){
          canClaim=BigInt(observation.claimBalance)>0n
          const owned=canClaim||BigInt(observation.fixedBalance)>0n
          const matured=BigInt(observation.blockTimestamp)>BigInt(observation.endTime)
          canWithdraw=matured&&BigInt(observation.fixedBalance)>0n
          state=owned?(matured?'matured':canClaim?'claimable':'active'):'no_position'
          if(!owned&&BigInt(observation.adapterLiquidity??'0')===0n&&(await db.query("SELECT 1 FROM saffron_incentives.user_operations WHERE intent_id=$1 AND wallet=$2 AND action='withdraw' AND canonical=TRUE LIMIT 1",[job.id,wallet.toLowerCase()])).rowCount)state='completed'
        }else if(BigInt(observation.claimSupply)>0n){
          canRecover=BigInt(observation.claimBalance)>0n
          state=canRecover?'fixed_awaiting_funding':'occupied'
        }else if(job.state==='created'){state=isRequester?eligible.state:'no_position';depositable=isRequester&&eligible.depositable}
      }
      if(job.cancel_requested&&job.state!=='retired'&&!observation?.isStarted){state='retirement_requested';depositable=false}
      const transactions=(await db.execution.transactionMetadata(job.id)).map(tx=>({hash:tx.resolved_hash??tx.hash,originalHash:tx.hash,step:tx.step,nonce:String(tx.nonce),confirmed:tx.receipt?.status==='0x1'&&tx.resolution_kind!=='cancelled',reverted:tx.receipt?.status==='0x0'||tx.resolution_kind==='cancelled'}))
      return jsonSafe({id:job.id,wallet:job.wallet,positionWallet:wallet.toLowerCase(),isRequester,programId:job.snapshot.programId,createdAt:job.created_at,planHash:job.plan_hash,plan:job.plan,
        snapshot:job.snapshot,signer:job.signer,observation,state,depositable,canClaim,canWithdraw,canRecover,
        workerState:job.state,fundingState:job.funding_state,cancelRequested:job.cancel_requested,error:job.error,transactions,
        nextAttemptAt:job.next_attempt_at,fundingOperator:job.funding_operator})
    },
    async detail(id,wallet,admin=false,{fresh=true}={}){
      let job=await db.getIntent(id)
      if(!job)throw fault(404,'Deployment not found for this wallet.')
      if(fresh&&job.plan.vault)await refresh(id)
      job=await db.getIntent(id)
      const deployment=await service.describe(job,admin?job.wallet:wallet)
      if(!admin&&!deployment.isRequester&&!await db.hasPositionHistory(id,wallet)){
        if(job.plan.vault&&eligibility(deployment.observation,now()).state==='checking')throw fault(503,'Position ownership is unavailable. Retry shortly.')
        if(!ownsPosition(deployment))throw fault(404,'Deployment not found for this wallet.')
      }
      return deployment
    },
    async list(wallet,admin=false,page={}){
      const {jobs,nextCursor}=await db.list({...page,wallet,admin}),deployments=[]
      for(let start=0;start<jobs.length;start+=4){
        const rows=await Promise.all(jobs.slice(start,start+4).map(async job=>{
          const row=await service.describe(job,admin?job.wallet:wallet)
          return admin||row.isRequester||ownsPosition(row)||!row.observation?.verified||await db.hasPositionHistory(job.id,wallet)?row:null
        }))
        deployments.push(...rows.filter(Boolean))
      }
      return {deployments,nextCursor,creatorOnline:await db.execution.workerOnline(signer),positionsUpdating:await db.positionsUpdating()}
    },
    async context(id,wallet){
      const deployment=await service.detail(id,wallet)
      return {deployment,job:{plan:deployment.plan,signer:deployment.signer,snapshot:deployment.snapshot,wallet:deployment.positionWallet},snapshot:deployment.observation}
    },
    async recordUserAction(id,wallet,hash){
      if(!/^0x[0-9a-f]{64}$/i.test(hash??''))throw fault(400,'Provide a transaction hash.')
      const job=await db.getIntent(id)
      if(!job?.plan.vault)throw fault(404,'Position not found.')
      await refresh(id)
      const deployment=await service.describe(await db.getIntent(id),wallet)
      const [receipt,transaction,head,chain]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_blockNumber',[]),rpc('eth_chainId',[])])
      if(BigInt(chain)!==4663n||!receipt||!transaction||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()
        ||BigInt(head)<BigInt(receipt.blockNumber)+BigInt((config?.confirmations??2)-1)
        ||(await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash)throw fault(409,'Transaction confirmations are not available yet.')
      let action
      try{action=userActionEvidence({receipt,transaction,job:{...deployment,wallet:wallet.toLowerCase()}})}catch(error){throw fault(409,error.message)}
      await db.query(`INSERT INTO saffron_incentives.user_operations(hash,intent_id,wallet,action,receipt) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(hash) DO UPDATE SET receipt=EXCLUDED.receipt,canonical=TRUE`,[hash.toLowerCase(),id,wallet.toLowerCase(),action,receipt])
      return {action,deployment:await service.detail(id,wallet,false,{fresh:false})}
    },
    async reconcileTransaction(id,operator,original,hash){
      if(![original,hash].every(value=>/^0x[0-9a-f]{64}$/i.test(value??'')))throw fault(400,'Provide the saved and replacement transaction hashes.')
      const job=await db.getIntent(id),tx=(await db.execution.transactionMetadata(id)).find(row=>row.hash.toLowerCase()===original.toLowerCase())
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
