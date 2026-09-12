import { verifyPayment, paymentData,proofHash } from './payment-proof.mjs'
import { creationFeeRecipient,quoteCreationFee } from './creation-fee.mjs'
import { resolvePlan } from '../shared/deployment-plan.mjs'
import { readVault,readPosition } from '../shared/vault-reader.mjs'
import { discoverPositionOwners } from './position-discovery.mjs'
import { eligibility,sameAddress } from '../shared/vault-lifecycle.mjs'
import { cents,snapshotFor,fault,jsonSafe,validAddress,UINT256_MAX } from '../shared/incentives.mjs'
import { userActionEvidence } from '../shared/user-evidence.mjs'
import { encodeFunctionData,decodeFunctionResult } from 'viem'
import { abi } from '../shared/vault-lifecycle.mjs'
import { intakeReadiness } from './intake-policy.mjs'
import { deploymentProgress } from './deployment-progress.mjs'
import { operationalStatus } from './operational-status.mjs'
import { createCheckoutProbe } from './checkout-readiness.mjs'
import { createVaultTvl } from './vault-tvl.mjs'
import { createRefunds } from './refunds.mjs'

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
    if(!validAddress(signer)||!config?.factoryCodeHash||!config?.vaultTypeHash||!config?.adapterTypeHash||!origin) throw fault(503,'Deployment is not configured yet.')
  }
  async function size(offer,principalCents,wallet){
    requireConfigured()
    const snapshot=snapshotFor(offer,principalCents,wallet)
    const plan=await resolvePlan({snapshot},rpc,usdQuote,config)
    return plan
  }
  const checkoutProbe=createCheckoutProbe({rpc,feeRecipient,signer,requireConfigured,size,now})
  const vaultTvl=createVaultTvl({db,rpc,usdQuote,confirmations:config?.confirmations??2,now})
  const refunds=createRefunds({db,rpc,confirmations:config?.confirmations??2,now})
  const service={
    refunds,
    refresh,
    async readiness(offers){
      // Operator enablement and canonical payment discovery remain. Neither
      // campaign targets nor wallet inventory determine whether a user can pay.
      const intake=await intakeReadiness({db,rpc,signer,confirmations:config?.confirmations??2,now})
      const checkout=await checkoutProbe(offers??(await db.catalog()).offers)
      return {...intake,intakeReady:intake.canQuote,canQuote:intake.canQuote&&checkout.ready,
        checks:checkout.checks,offerReady:checkout.offerReady,checkedAt:checkout.checkedAt,reasons:[...intake.reasons,...checkout.reasons]}
    },
    async auditCheckoutSettlements(){
      for(const cursor of await db.checkoutWatermarks()){
        let block
        try{if(cursor.block_number!==null)block=await rpc('eth_getBlockByNumber',['0x'+BigInt(cursor.block_number).toString(16),false])}
        catch{throw fault(503,'Checkout settlement verification is unavailable.')}
        if(!block?.hash)throw fault(503,'Checkout settlement verification is unavailable.')
        if(block.hash!==cursor.block_hash){
          await db.reopenCheckoutSettlements(cursor.id)
          throw fault(503,'Checkout settlement requires reconciliation.')
        }
      }
    },
    async operatorStatus(){
      const backlog=(await db.query(`SELECT count(*) FILTER(WHERE state NOT IN ('created','retired','refunded'))::int AS pending,
        count(*) FILTER(WHERE state NOT IN ('created','retired','refunded') AND created_at<NOW()-INTERVAL '24 hours')::int AS stalled
        FROM saffron_incentives.vault_jobs`)).rows[0]
      const readiness=await service.readiness()
      return {signer,...backlog,workerOnline:await db.execution.workerOnline(signer),readiness,...await operationalStatus(db,readiness,now)}
    },
    async reconcileBudget(id,operator){
      const result=await db.auditBudget(id)
      if(!result.valid)throw fault(409,'Ledger totals differ. Repair the accounting evidence before resuming this campaign.')
      await db.query('UPDATE saffron_incentives.budget_pools SET reconciliation_required=FALSE,paused=TRUE,revision=revision+1,updated_by=$2 WHERE id=$1',[id,operator])
      return (await db.catalog(true)).budgets.find(row=>row.id===id)
    },
    async programs(){
      const {offers}=await db.catalog(),readiness=await service.readiness(offers)
      const tvl=vaultTvl.current(offers)
      // Expose offer terms only. Planning amounts, usage and readiness internals
      // are administrator data, never front-page or payment-modal payloads.
      return {offers:offers.map(offer=>({id:offer.id,revision:offer.revision,pairId:offer.pairId,pairRevision:offer.pairRevision,
        chainId:offer.chainId,pool:offer.pool,feeTier:offer.feeTier,token0:offer.token0,token1:offer.token1,vaultTvl:tvl[offer.id],
        budgetPoolId:offer.budgetPoolId,apr:offer.apr,days:offer.days,requestFeeWei:offer.requestFeeWei??null,sortOrder:offer.sortOrder,isNew:offer.isNew,active:offer.active,
        budget:{id:offer.budget.id,revision:offer.budget.revision,paused:offer.budget.paused},
        availability:offer.budget.paused||offer.budget.reconciliationRequired||!readiness.canQuote||!readiness.offerReady[offer.id]?'New requests are temporarily paused.':null})),
        creatorOnline:readiness.workerOnline,readiness:{canQuote:readiness.canQuote,intakeReady:readiness.intakeReady,checks:readiness.checks,checkedAt:readiness.checkedAt}}
    },
    /** Admin-only advisory for the portfolio. It never changes admission. */
    async capacityAdvisory(){
      const {budgets}=await db.catalog(true)
      return {campaigns:budgets.filter(b=>b.accounting).map(b=>{
        const a=b.accounting,committed=BigInt(a.fundedBudgetCents)+BigInt(a.reservedBudgetCents),target=BigInt(b.advisoryBudgetCents??a.budgetCents)
        return {id:b.id,name:b.name,nearCapacity:target>0n&&committed*100n>=target*90n,
          overTarget:committed>target,targetBudgetCents:target.toString(),committedBudgetCents:committed.toString()}
      })}
    },
    async quote(wallet,programId,amount,recoveryHash,{clientHash=null,requestKey=null}={}){
      const existing=await db.checkoutQuote(clientHash,requestKey)
      if(existing){
        if(existing.wallet!==wallet.toLowerCase()||existing.programId!==programId||existing.principalCents!==cents(amount)||existing.recoveryHash!==recoveryHash)throw fault(409,'Checkout request terms changed.')
        return {...existing,paymentData:paymentData(existing)}
      }
      requireConfigured()
      const recipient=creationFeeRecipient(feeRecipient)
      await service.auditCheckoutSettlements()
      const readiness=await service.readiness()
      if(!readiness.canQuote)throw fault(503,'New requests are paused: '+readiness.reasons.join(', ').replaceAll('_',' ')+'. Your saved payments remain available.')
      const principalCents=cents(amount),offer=await db.offer(programId)
      const plan=await size(offer,principalCents,wallet)
      if(sameAddress(wallet,recipient))throw fault(400,'The creation fee receiver cannot request a vault by paying itself.')
      if(typeof recoveryHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(recoveryHash))throw fault(400,'A request recovery commitment is required.')
      const fee=quoteCreationFee(recipient,offer.requestFeeWei)
      // Retain a nonce checkpoint for backup/restore reconciliation, without
      // collecting signer balances, fees, or gas-spending totals.
      const signerNonce=BigInt(await rpc('eth_getTransactionCount',[signer,plan.sizingBlock])).toString()
      const quote=await db.putQuote({offer,principalCents,wallet,origin,plan,signer,fee,recoveryHash,clientHash,requestKey,intakeRevision:readiness.policy.revision,signerNonce})
      return {...quote,paymentData:paymentData(quote)}
    },
    /** Verify the payment chain evidence before admitting exactly one creation.
     * Keep confirmed but blocked payments for operator resolution; never prompt
     * the user to pay again because a response or later capacity check failed.
     */
    async recoverPayment(quoteId,recoverySecret){
      const quote=await db.quote(quoteId)
      if(!quote||typeof recoverySecret!=='string'||!/^0x[0-9a-f]{64}$/i.test(recoverySecret)||proofHash(recoverySecret)!==quote.recoveryHash)throw fault(403,'Request recovery record is required.')
      const payment=(await db.query(`SELECT o.hash,o.state,o.kind,o.amount_wei FROM saffron_incentives.payment_obligations o
        WHERE quote_id=$1 ORDER BY EXISTS(SELECT 1 FROM saffron_incentives.payment_proofs p WHERE p.hash=o.hash) DESC,o.created_at LIMIT 1`,[quoteId])).rows[0]
      if(!payment)return {state:'discovering'}
      await verifyPayment(quote,payment.hash,recoverySecret,rpc,{confirmations:config?.confirmations??2,allowAmountMismatch:true})
      const intent=(await db.query('SELECT id FROM saffron_incentives.deployment_intents WHERE quote_id=$1',[quoteId])).rows[0]
      return {state:payment.state,kind:payment.kind,amountWei:payment.amount_wei,paymentHash:payment.hash,wallet:quote.wallet,...(intent?{deployment:await service.detail(intent.id,quote.wallet,false,{fresh:false})}:{})}
    },
    async paymentProof(quoteId,paymentHash,recoverySecret){
      const quote=await db.quote(quoteId)
      if(!quote)throw fault(404,'Payment quote not found.')
      return verifyPayment(quote,paymentHash,recoverySecret,rpc,{confirmations:config?.confirmations??2})
    },
    async acceptPayment(quoteId,paymentHash,recoverySecret){
      const quote=await db.quote(quoteId)
      if(!quote)throw fault(404,'Payment quote not found.')
      const payment=await verifyPayment(quote,paymentHash,recoverySecret,rpc,{confirmations:config?.confirmations??2,allowAmountMismatch:true})
      try{return {...await db.acceptDeployment({wallet:payment.wallet,quoteId,payment,origin}),wallet:payment.wallet}}
      catch(error){
        await db.query('UPDATE saffron_incentives.payment_proofs SET state=$2,error=$3 WHERE hash=$1',
          [payment.hash,'needs_attention','Confirmed payment is awaiting operator review.'])
        const row=await db.paymentObligation(payment.hash)
        if(row?.kind==='creation-fee'||row?.kind==='late-fee')await db.paymentAttention(payment.hash,payment.late?'late-fee':'policy-blocked')
        throw fault(409,'Payment confirmed, but creation needs operator resolution. Your payment is saved; do not pay again.')
      }
    },
    async admitOriginalPayment(hash,resolution){
      const row=await db.paymentObligation(hash)
      if(!row)throw fault(404,'Received payment not found.')
      const quote=await db.quote(row.quote_id)
      requireConfigured()
      await service.auditCheckoutSettlements()
      if(quote.plan.factoryCodeHash!==config.factoryCodeHash||quote.plan.vaultTypeHash!==config.vaultTypeHash||quote.plan.adapterTypeHash!==config.adapterTypeHash||quote.signer!==signer.toLowerCase())throw fault(409,'The original plan is outside current execution policy.')
      const payment=await verifyPayment(quote,hash,null,rpc,{confirmations:config?.confirmations??2,checkCapability:false})
      return db.acceptDeployment({wallet:quote.wallet,quoteId:quote.id,payment,origin:quote.origin,resolution})
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
      if(job.cancel_requested&&!observation?.isStarted){state='needs_attention';depositable=false} // Preserve historical stops without restarting legacy work.
      const journal=await db.execution.transactionMetadata(job.id)
      const payment=(await db.query('SELECT o.state FROM saffron_incentives.payment_obligations o JOIN saffron_incentives.payment_proofs p ON p.hash=o.hash WHERE p.quote_id=$1',[job.quote_id])).rows[0]
      const progress=await deploymentProgress({job,observation,journal,payment,policy:await db.intakePolicy(job.signer),rpc,confirmations:config?.confirmations??2,now})
      const transactions=journal.map(tx=>({hash:tx.resolved_hash??tx.hash,originalHash:tx.hash,step:tx.step,nonce:String(tx.nonce),confirmed:progress.stages.some(s=>s.hash===(tx.resolved_hash??tx.hash)&&s.state==='complete'),reverted:tx.receipt?.status==='0x0'||tx.resolution_kind==='cancelled'}))
      if(depositable&&(!progress.verificationAvailable||progress.stages.some(s=>s.state!=='complete'))){depositable=false;state='checking'}
      const refund=await refunds.forDeployment(job.id)
      if(refund){depositable=false;if(!canClaim&&!canWithdraw&&!canRecover)state=refund.state}
      return jsonSafe({id:job.id,wallet:job.wallet,positionWallet:wallet.toLowerCase(),isRequester,programId:job.snapshot.programId,createdAt:job.created_at,planHash:job.plan_hash,plan:job.plan,
        snapshot:job.snapshot,signer:job.signer,observation,state,depositable,canClaim,canWithdraw,canRecover,progress,refund,
        workerState:job.state,fundingState:!fresh?'unverified':observation.isStarted?'spent':BigInt(observation.variableSupply)===BigInt(observation.variableCapacity)?'funded':BigInt(observation.variableSupply)>0n?'partial':'awaiting_external',cancelRequested:job.cancel_requested,error:job.error,transactions,
        nextAttemptAt:job.next_attempt_at})
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
        await refunds.poll()
        const jobs=await db.execution.tracked();let index=0
        await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(index<jobs.length)await refresh(jobs[index++].intent_id)}))
        for(const budget of (await db.catalog(true)).budgets)await db.auditBudget(budget.id)
        await vaultTvl.refresh((await db.catalog()).offers)
      }finally{polling=false}
    },
  }
  return service
}
