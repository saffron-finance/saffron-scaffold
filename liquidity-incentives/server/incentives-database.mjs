import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { deploymentPage,deploymentCursor } from './deployment-pagination.mjs'
import { createExecutionDatabase } from './execution-database.mjs'
import { createCheckoutReservations } from './checkout-reservations.mjs'
import { createPaymentResolutions } from './payment-resolutions.mjs'
import { createIntakePolicy } from './intake-policy.mjs'
import { proofHash,paymentData } from './payment-proof.mjs'
import { campaignTerms,campaignPremiumCents } from '../shared/campaign.mjs'
import { CHAIN_ID, FACTORY, normalizePair, normalizeProgram, normalizeBudget, validAddress, integer,
  digest, snapshotFor, jsonSafe, fault, UINT256_MAX, cents } from '../shared/incentives.mjs'

const schema = 'saffron_incentives'
const conflict = () => fault(409, 'This row changed. Refresh before saving.')
const asBudget = row => ({ advisoryBudgetCents:row.advisory_budget_cents??row.campaign?.budgetCents??null, campaign:row.campaign??null, id: row.id, revision: row.revision, name: row.name, chainId: row.chain_id, rewardAsset: row.reward_asset,
  decimals: row.decimals, limitRaw: row.limit_raw, reservedRaw: row.reserved_raw, allocatedRaw: row.allocated_raw,
  heldRaw:String(row.held_raw??0),availableRaw: [0n,BigInt(row.limit_raw)-BigInt(row.reserved_raw)-BigInt(row.allocated_raw)-BigInt(row.held_raw??0)].reduce((a,b)=>a>b?a:b).toString(),
  paused: row.paused, reconciliationRequired: row.reconciliation_required })

/** All acceptance/accounting mutations use real SQL transactions. No RPC occurs under a row lock. */
export function createIncentivesDatabase({ connection, now = Date.now,
  quoteMs = 120_000, initializationRetryMs = 5_000 } = {}) {
  const pool = new pg.Pool({ connectionTimeoutMillis:5_000, ...connection, max: 8, options: '-c timezone=UTC' })
  // pg removes a failed idle client. Subsequent requests reconnect; the HTTP
  // boundary returns generic failures rather than crashing/logging provider data.
  pool.on('error',()=>{})
  let initialized=false,initializing=null,retryAt=0,initializationError,closing=false,closed
  async function initialize(){
    const sql=await readFile(new URL('./incentives.sql', import.meta.url), 'utf8')
    const client=await pool.connect()
    try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-incentives-schema',0))");await client.query(sql);await client.query('COMMIT')}
    catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}
  }
  function ready(){
    if(closing)return Promise.reject(new Error('Database is closed.'))
    if(initialized)return Promise.resolve()
    if(initializing)return initializing
    if(Date.now()<retryAt)return Promise.reject(initializationError)
    // One initialization attempt is shared by all requests. A failed attempt
    // leaves a bounded backoff, not a permanently rejected startup promise.
    initializing=initialize().then(()=>{initialized=true;initializationError=undefined},error=>{
      initializationError=error;retryAt=Date.now()+initializationRetryMs;throw error
    }).finally(()=>{initializing=null})
    return initializing
  }
  void ready().catch(()=>{})
  const query = async (sql, values = []) => { await ready(); return pool.query(sql, values) }
  async function transaction(run) {
    await ready()
    const client = await pool.connect()
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result }
    catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  async function lockBudget(client, id) {
    const row = (await client.query(`SELECT * FROM ${schema}.budget_pools WHERE id=$1 FOR UPDATE`, [id])).rows[0]
    if (!row) throw fault(404, 'Funding budget not found.')
    return row
  }
  async function entry(client, { key = randomUUID(), budgetId, intentId = null, kind, limit = '0', reserved = '0', allocated = '0', actor, evidence = null }) {
    await client.query(`INSERT INTO ${schema}.budget_entries (event_key,budget_pool_id,intent_id,kind,limit_delta,reserved_delta,allocated_delta,actor,evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [key,budgetId,intentId,kind,String(limit),String(reserved),String(allocated),actor,evidence])
  }
  async function getIntent(id, client = { query }) {
    return (await client.query(`SELECT i.*,j.signer,j.factory,j.chain_id,j.state,j.plan,j.operation,j.operation_actor,
      j.resume_version,j.attempts,j.error,j.lease_owner,j.lease_until,j.next_attempt_at,j.intent_id,j.funding_observed_at
      FROM ${schema}.deployment_intents i JOIN ${schema}.vault_jobs j ON j.intent_id=i.id WHERE i.id=$1`, [id])).rows[0] ?? null
  }
  /** Derive USD and fixed-side accounting from immutable accepted terms.
   * Reservations and funded capacity are separate; actual LP entry is not inferred
   * from a premium payment. Unpaid quotes do not consume the planning target.
   */
  async function campaignAccounting(client,budget,excludeQuote=null){
    if(!budget.campaign)return null
    const terms=budget.campaign
    const rows=(await client.query(`SELECT i.snapshot,i.accepted_plan,r.*,
      o.snapshot AS observation FROM ${schema}.budget_reservations r
      JOIN ${schema}.deployment_intents i ON i.id=r.intent_id
      LEFT JOIN ${schema}.vault_observations o ON o.intent_id=i.id
      WHERE r.budget_pool_id=$1 AND r.released_raw<r.premium_raw`,[budget.id])).rows
    let committed=0n,funded=0n,spent=0n,fundedBudget=0n,deposited=0n
    for(const row of rows){
      const principal=BigInt(row.snapshot.fixedCapacityAmount)
      const premium=BigInt(row.accepted_plan.premiumCents??campaignPremiumCents(terms,principal))
      committed+=principal;spent+=premium
      funded+=principal*BigInt(row.allocated_raw)/BigInt(row.premium_raw)
      fundedBudget+=premium*BigInt(row.allocated_raw)/BigInt(row.premium_raw)
      if(row.observation?.verified&&(row.observation.isStarted||BigInt(row.observation.claimSupply??0)>0n))deposited+=principal
    }
    // Unpaid quotes do not reserve or consume a planning target.
    const held=0n,heldBudget=0n,anonymousHeld=0n,anonymousBudget=0n
    return {budgetCents:terms.budgetCents,targetCapacityCents:terms.capacityCents,
      fundedBudgetCents:fundedBudget.toString(),reservedBudgetCents:(spent-fundedBudget).toString(),heldBudgetCents:heldBudget.toString(),
      fundedCapacityCents:funded.toString(),reservedCapacityCents:(committed-funded).toString(),heldCapacityCents:held.toString(),
      anonymousHeldCapacityCents:anonymousHeld.toString(),anonymousHeldBudgetCents:anonymousBudget.toString(),availableBudgetCents:(BigInt(terms.budgetCents)-spent-heldBudget).toString(),
      availableCapacityCents:(BigInt(terms.capacityCents)-committed-held).toString(),fixedDepositedCents:deposited.toString()}
  }
  const db = {
    pool, get ready(){return ready()}, query, transaction, lockBudget, entry, getIntent, now, campaignAccounting,
    async checkoutQuote(clientHash,requestKey){
      if(!clientHash||!requestKey)return null
      return (await query(`SELECT body FROM ${schema}.deployment_quotes WHERE client_hash=$1 AND request_key=$2`,[clientHash,requestKey])).rows[0]?.body??null
    },
    close: () => {
      closing=true
      return closed??=(async()=>{try{await initializing}catch{}await pool.end()})()
    },
    async catalog(admin = false) {
      return transaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const pairs = (await client.query(`SELECT body FROM ${schema}.pairs ORDER BY id`)).rows.map(row => row.body)
        const programs = (await client.query(`SELECT body FROM ${schema}.programs ORDER BY (body->>'sortOrder')::int,id`)).rows.map(row => row.body)
        const budgets = await Promise.all((await client.query(`SELECT * FROM ${schema}.budget_pools ORDER BY id`)).rows.map(async row=>({...asBudget({...row,held_raw:await db.rawHolds(client,row.id)}),accounting:await campaignAccounting(client,row)})))
        if (admin) return { pairs, programs, budgets }
        const offers = programs.filter(p => p.active).flatMap(p => {
          const pair = pairs.find(row => row.id === p.pairId && row.active), budget = budgets.find(row => row.id === p.budgetPoolId)
          return pair && budget ? [{ ...pair, ...p, pairId: pair.id, pairRevision: pair.revision, days:budget.campaign?.days??p.days,apr:budget.campaign?Number(budget.campaign.aprPercent):p.apr,capacityUsd: Number(p.maximumCents) / 100, budget }] : []
        })
        return { offers }
      })
    },
    async offer(id) {
      const result = (await db.catalog()).offers.find(offer => offer.id === id)
      if (!result) throw fault(409, 'This program is unavailable. Refresh offers.')
      return result
    },
    async quoteToken(address) {
      const { pairs } = await db.catalog(true)
      return pairs.find(pair => pair.token1.address === address.toLowerCase())?.token1 ?? null
    },
    async savePair(input, actor) {
      const value = normalizePair(input)
      return transaction(async client => {
        await client.query(`SELECT id FROM ${schema}.pairs WHERE id=$1 FOR UPDATE`,[value.id])
        const invalid = await client.query(`SELECT 1 FROM ${schema}.programs p JOIN ${schema}.budget_pools b ON b.id=p.budget_pool_id
          WHERE p.pair_id=$1 AND (b.reward_asset<>$2 OR b.decimals<>$3) LIMIT 1`, [value.id,value.token0.address,value.token0.decimals])
        if (invalid.rowCount) throw fault(409, 'Existing programs require this pair to retain its budget reward asset and decimals.')
        const body = { ...value, revision: value.revision + 1 }
        const result = value.revision === 0
          ? await client.query(`INSERT INTO ${schema}.pairs (id,revision,body,updated_by) VALUES ($1,1,$2,$3) ON CONFLICT DO NOTHING RETURNING body`, [value.id,body,actor])
          : await client.query(`UPDATE ${schema}.pairs SET revision=revision+1,body=$2,updated_by=$3,updated_at=NOW() WHERE id=$1 AND revision=$4 RETURNING body`, [value.id,body,actor,value.revision])
        if (!result.rowCount) throw conflict()
        return result.rows[0].body
      })
    },
    async saveBudget(input, actor) {
      const value = normalizeBudget(input)
      return transaction(async client => {
        const previous = value.revision ? await lockBudget(client,value.id) : null
        if (previous && (previous.revision !== value.revision || previous.reward_asset !== value.rewardAsset || previous.decimals !== value.decimals)) throw conflict()
        if(previous&&digest(previous.campaign??null)!==digest(value.campaign)){
          const committed=await client.query(`SELECT 1 FROM ${schema}.deployment_quotes WHERE budget_pool_id=$1 LIMIT 1`,[value.id])
          if(committed.rowCount)throw fault(409,'Campaign economics are frozen after the first quote. Create a new campaign to change budget, capacity or APR.')
        }
        const values = [value.id,value.name,value.rewardAsset,value.decimals,value.limitRaw,value.paused,actor,value.campaign]
        const result = previous
          ? await client.query(`UPDATE ${schema}.budget_pools SET name=$2,reward_asset=$3,decimals=$4,limit_raw=$5,paused=$6,campaign=$8,revision=revision+1,updated_by=$7,updated_at=NOW() WHERE id=$1 RETURNING *`, values)
          : await client.query(`INSERT INTO ${schema}.budget_pools (id,revision,name,chain_id,reward_asset,decimals,limit_raw,paused,updated_by,campaign)
              VALUES ($1,1,$2,4663,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`, values)
        if (!result.rowCount) throw conflict()
        await entry(client,{ key: `budget:${value.id}:${result.rows[0].revision}`, budgetId: value.id, kind: 'adjust-limit',
          limit: BigInt(value.limitRaw) - BigInt(previous?.limit_raw ?? '0'), actor, evidence: { name:value.name,paused:value.paused,revision:result.rows[0].revision,campaign:value.campaign } })
        return asBudget({...result.rows[0],held_raw:await db.rawHolds(client,value.id)})
      })
    },
    /** Create campaign economics and its offer together, before admitting payments. */
    async saveCampaign(input,actor){
      let campaign
      try{campaign=campaignTerms(input)}catch(error){throw fault(400,error.message)}
      return transaction(async client=>{
        const pair=(await client.query(`SELECT body FROM ${schema}.pairs WHERE id=$1 FOR SHARE`,[input.pairId])).rows[0]?.body
        if(!pair)throw fault(400,'Choose a configured pair.')
        const budget=normalizeBudget({id:input.id,revision:0,name:input.name,chainId:4663,rewardAsset:pair.token0.address,decimals:pair.token0.decimals,
          limitRaw:UINT256_MAX.toString(),paused:!input.active,campaign})
        const program=normalizeProgram({id:input.id,revision:0,pairId:pair.id,budgetPoolId:budget.id,apr:Number(Number(campaign.aprPercent).toFixed(2)),days:campaign.days,
          minimumCents:cents(input.minimumUsd??'1'),maximumCents:UINT256_MAX.toString(),sortOrder:0,isNew:true,active:true})
        const inserted=await client.query(`INSERT INTO ${schema}.budget_pools(id,revision,name,chain_id,reward_asset,decimals,limit_raw,paused,updated_by,campaign)
          VALUES($1,1,$2,4663,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,[budget.id,budget.name,budget.rewardAsset,budget.decimals,budget.limitRaw,budget.paused,actor,campaign])
        if(!inserted.rowCount)throw fault(409,'Campaign ID already exists. Choose a new ID.')
        await entry(client,{key:'budget:'+budget.id+':1',budgetId:budget.id,kind:'create-campaign',limit:budget.limitRaw,actor,evidence:{campaign}})
        const body={...program,revision:1}
        await client.query(`INSERT INTO ${schema}.programs(id,revision,pair_id,budget_pool_id,body,updated_by) VALUES($1,1,$2,$3,$4,$5)`,[program.id,pair.id,budget.id,body,actor])
        return {campaign,budgetId:budget.id,program:body}
      })
    },
    /** Update an internal planning target without changing any quoted rate. */
    async saveAdvisoryBudget(id,input,actor){
      const amount=cents(input.budgetUsd)
      return transaction(async client=>{
        const budget=await lockBudget(client,id)
        if(budget.revision!==input.revision)throw conflict()
        await client.query(`UPDATE ${schema}.budget_pools SET advisory_budget_cents=$2,revision=revision+1,updated_by=$3,updated_at=NOW() WHERE id=$1`,[id,amount,actor])
        await entry(client,{budgetId:id,kind:'advisory-target',actor,evidence:{budgetCents:amount}})
        return {saved:true}
      })
    },
    async saveProgram(input, actor) {
      const value = normalizeProgram(input)
      return transaction(async client => {
        const budget = await lockBudget(client,value.budgetPoolId)
        const pair = (await client.query(`SELECT body FROM ${schema}.pairs WHERE id=$1 FOR SHARE`, [value.pairId])).rows[0]?.body
        if (!pair || pair.token0.address !== budget.reward_asset || pair.token0.decimals !== budget.decimals) throw fault(400, 'Choose a pair and budget with the same reward asset and decimals.')
        const body = { ...value, revision: value.revision + 1 }
        const values = [value.id,value.pairId,value.budgetPoolId,body,actor]
        const result = value.revision === 0
          ? await client.query(`INSERT INTO ${schema}.programs (id,revision,pair_id,budget_pool_id,body,updated_by) VALUES ($1,1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING body`, values)
          : await client.query(`UPDATE ${schema}.programs SET revision=revision+1,pair_id=$2,budget_pool_id=$3,body=$4,updated_by=$5,updated_at=NOW() WHERE id=$1 AND revision=$6 RETURNING body`, [...values,value.revision])
        if (!result.rowCount) throw conflict()
        return result.rows[0].body
      })
    },
    async putQuote({ offer, principalCents, wallet, origin, plan, signer, fee, recoveryHash,clientHash=null,requestKey=null,intakeRevision=null,signerNonce=null }) {
      integer(principalCents,{positive:true}); integer(plan.premium,{positive:true}); integer(plan.liquidity,{positive:true})
      if (!validAddress(wallet) || !validAddress(signer) || new URL(origin).origin !== origin) throw fault(400,'Invalid deployment identity.')
      if (offer.budget.paused || offer.budget.reconciliationRequired) throw fault(409,'This campaign is paused. Refresh offers.')
      if(!Number.isFinite(plan.usdCheckedAt)||now()-plan.usdCheckedAt>60_000||plan.usdCheckedAt>now()+5000
        ||fee?.checkedAt&&(now()-fee.checkedAt>60_000||fee.checkedAt>now()+5000))throw fault(409,'Fresh prices are required before issuing payment terms.')
      const expiresAt = new Date(now()+quoteMs).toISOString()
      if (Date.parse(expiresAt)<=now()) throw fault(409,'Prices expired. Request a fresh quote.')
      const snapshot = snapshotFor(offer,principalCents,wallet)
      const body = jsonSafe({ signerNonce,fee,recoveryHash,issuedAt:new Date(now()).toISOString(),paymentDeadline:expiresAt, id:randomUUID(),wallet:wallet.toLowerCase(),origin,programId:offer.id,programRevision:offer.revision,pairId:offer.pairId,
        pairRevision:offer.pairRevision,budgetPoolId:offer.budgetPoolId,budgetRevision:offer.budget.revision,principalCents,signer:signer.toLowerCase(),snapshot,plan,expiresAt })
      body.planHash = digest({snapshot,plan:body.plan,signer:body.signer,programRevision:body.programRevision,pairRevision:body.pairRevision,budgetRevision:body.budgetRevision})
      let resultBody=body
      await transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        if(clientHash){
          if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestKey??''))throw fault(400,'A checkout request key is required.')
          const existing=(await client.query(`SELECT body FROM ${schema}.deployment_quotes WHERE client_hash=$1 AND request_key=$2`,[clientHash,requestKey])).rows[0]?.body
          if(existing){
            if(existing.wallet!==body.wallet||existing.programId!==body.programId||existing.principalCents!==body.principalCents||existing.recoveryHash!==body.recoveryHash)throw conflict()
            resultBody=existing;return
          }
        }
        if(intakeRevision!==null)await db.requireIntake(client,body.signer,intakeRevision)
        const locked=await lockBudget(client,body.budgetPoolId)
        if(locked.paused||locked.reconciliation_required||locked.revision!==body.budgetRevision)throw fault(409,'Campaign changed. Refresh before paying.')
        // Targets are advisory. Distinct requests from the same wallet/browser
        // can exceed campaign targets; the request key alone prevents replay.
        await client.query(`INSERT INTO ${schema}.deployment_quotes (id,wallet,program_id,budget_pool_id,body,expires_at,payment_commitment,client_hash,request_key,hold_raw,sizing_block) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [body.id,body.wallet,body.programId,body.budgetPoolId,body,new Date(body.paymentDeadline),fee?paymentData(body):null,clientHash,requestKey,plan.premium,BigInt(plan.sizingBlock).toString()])
      })
      return resultBody
    },
    async quote(id) { return (await query(`SELECT body FROM ${schema}.deployment_quotes WHERE id=$1`,[id])).rows[0]?.body ?? null },
    /** Release an abandoned unpaid hold using its private browser capability.
     * A payment racing cancellation is retained for operator resolution, never
     * silently discarded when its browser no longer displays it.
     */
    async withdrawQuote(id,secret){
      const quote=await db.quote(id)
      if(!quote||typeof secret!=='string'||proofHash(secret)!==quote.recoveryHash)throw fault(403,'Request recovery record is required.')
      return transaction(async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        await lockBudget(client,quote.budgetPoolId)
        const paid=await client.query(`SELECT 1 FROM ${schema}.payment_proofs WHERE quote_id=$1`,[id])
        if(paid.rowCount)throw fault(409,'This request has a payment. Recover it instead of discarding it.')
        await client.query(`UPDATE ${schema}.deployment_quotes SET hold_state='closing' WHERE id=$1 AND hold_state='held'`,[id])
        return {closing:true}
      })
    },
    /** Called only with canonical evidence from the payment verifier. */
    async recordPayment(payment){
      if(!payment?.verified)throw fault(400,'Verified payment evidence is required.')
      await db.retainPayment(payment)
      if(payment.exactAmount===false){
        const quote=await db.quote(payment.quoteId),kind=BigInt(payment.amountWei)<BigInt(quote.fee.amountWei)?'underpayment':'overpayment'
        await query(`INSERT INTO ${schema}.payment_exceptions(hash,quote_id,kind,evidence) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[payment.hash,payment.quoteId,kind,payment])
        await db.paymentAttention(payment.hash,kind)
        throw fault(409,'Received ETH differs from the creation fee. Operator resolution is required; do not pay again.')
      }
      const result=await query(`INSERT INTO ${schema}.payment_proofs(hash,quote_id,wallet,evidence)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING hash`,[payment.hash,payment.quoteId,payment.wallet,payment])
      if(result.rowCount)return
      const existing=(await query(`SELECT hash,quote_id FROM ${schema}.payment_proofs WHERE hash=$1 OR quote_id=$2`,[payment.hash,payment.quoteId])).rows
      if(existing.some(row=>row.hash===payment.hash&&row.quote_id===payment.quoteId)){
        await query(`UPDATE ${schema}.payment_proofs SET evidence=$2 WHERE hash=$1`,[payment.hash,payment]);return
      }
      // A double-paid quote must not create a second vault or wedge every later
      // payment behind a unique-key error. Retain the extra receipt for explicit
      // operator resolution; this code never initiates a refund transaction.
      if(existing.some(row=>row.quote_id===payment.quoteId))await query(`INSERT INTO ${schema}.payment_exceptions(hash,quote_id,kind,evidence)
        VALUES($1,$2,'duplicate-fee',$3) ON CONFLICT DO NOTHING`,[payment.hash,payment.quoteId,payment])
      await db.paymentAttention(payment.hash,'duplicate-fee')
      throw fault(409,'A payment was already bound to this request or another request; duplicate evidence is retained.')
    },
    async acceptDeployment({ wallet, quoteId, payment, origin,resolution=null }) {
      const quote = await db.quote(quoteId)
      if (!quote || quote.wallet!==wallet.toLowerCase() || quote.origin!==origin) throw fault(404,'Quote not found for this wallet.')
      if(!payment?.verified||payment.quoteId!==quoteId||payment.wallet!==quote.wallet||payment.planHash!==quote.planHash)throw fault(401,'A matching verified ETH payment is required.')
      await db.recordPayment(payment)
      return transaction(async client => {
        // Serialize payment admission and update advisory commitment totals atomically.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const budget = await lockBudget(client,quote.budgetPoolId)
        const replay=resolution?await db.resolutionReplay(client,payment.hash,'admit',resolution):null
        if(replay?.replayed)return replay.replayed
        const obligation=(await client.query(`SELECT * FROM ${schema}.payment_obligations WHERE hash=$1 FOR UPDATE`,[payment.hash])).rows[0]
        if(!['received','needs_attention','admitted'].includes(obligation.state))throw fault(409,'This payment is being resolved and cannot authorize creation.')
        if(resolution&&obligation.revision!==resolution.revision)throw fault(409,'Payment resolution changed. Refresh before continuing.')
        const accepted = (await client.query(`SELECT id FROM ${schema}.deployment_intents WHERE quote_id=$1`,[quoteId])).rows[0]
        if (accepted){
          if(resolution)throw fault(409,'The original request is already admitted. Resolve its saved worker operation.')
          return {id:accepted.id,replayed:true}
        }
        const checkoutRow=(await client.query(`SELECT hold_state FROM ${schema}.deployment_quotes WHERE id=$1 FOR UPDATE`,[quoteId])).rows[0]
        if((!['held','closing'].includes(checkoutRow.hold_state)||payment.late)&&!resolution)throw fault(409,'Payment requires operator resolution because its checkout was settled or paid late.')
        const program = (await client.query(`SELECT body FROM ${schema}.programs WHERE id=$1 FOR SHARE`,[quote.programId])).rows[0]?.body
        const pair = (await client.query(`SELECT body FROM ${schema}.pairs WHERE id=$1 FOR SHARE`,[quote.pairId])).rows[0]?.body
        // Payment was mined before its deadline; response delay cannot require another fee.
        if (!program?.active || !pair?.active || budget.paused || budget.reconciliation_required) throw fault(409,'Campaign execution is paused. The received payment requires operator resolution.')
        const premium=BigInt(quote.plan.premium)
        const id=randomUUID()
        await client.query(`INSERT INTO ${schema}.deployment_intents (id,quote_id,wallet,budget_pool_id,plan_hash,snapshot,accepted_plan)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,[id,quoteId,quote.wallet,quote.budgetPoolId,quote.planHash,quote.snapshot,quote.plan])
        await client.query(`INSERT INTO ${schema}.budget_reservations (intent_id,budget_pool_id,premium_raw,reserved_raw) VALUES ($1,$2,$3,$3)`,
          [id,quote.budgetPoolId,premium.toString()])
        await client.query(`UPDATE ${schema}.budget_pools SET reserved_raw=reserved_raw+$2 WHERE id=$1`,[quote.budgetPoolId,premium.toString()])
        await entry(client,{key:`accept:${id}`,budgetId:quote.budgetPoolId,intentId:id,kind:'reserve',reserved:premium,actor:quote.wallet})
        await client.query(`INSERT INTO ${schema}.vault_jobs (intent_id,signer,factory,chain_id,plan) VALUES ($1,$2,$3,$4,$5)`,[id,quote.signer,FACTORY,CHAIN_ID,quote.plan])
        await client.query(`UPDATE ${schema}.payment_proofs SET state='fulfilled',error=NULL WHERE quote_id=$1`,[quoteId])
        await client.query(`UPDATE ${schema}.deployment_quotes SET hold_state='accepted' WHERE id=$1`,[quoteId])
        await client.query(`UPDATE ${schema}.payment_obligations SET state='admitted',execution_allowed=TRUE,revision=revision+1,admission_override=$2,updated_at=NOW() WHERE hash=$1`,
          [payment.hash,resolution?{hash:payment.hash,quoteId,planHash:quote.planHash,actor:resolution.operator,requestKey:resolution.requestKey}:null])
        if(resolution)await db.auditPaymentResolution(client,payment.hash,'admit',resolution,replay.fingerprint,{id,replayed:false})
        return {id,replayed:false}
      })
    },
    async list({wallet,admin=false,...options}={}) {
      const {limit,after}=deploymentPage(options)
      const rows=await query(`SELECT i.id,to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM ${schema}.deployment_intents i WHERE ($2::boolean OR i.wallet=$1
        OR EXISTS(SELECT 1 FROM ${schema}.vault_observations o WHERE o.intent_id=i.id AND o.snapshot->'positionOwners' ? $1)
        OR EXISTS(SELECT 1 FROM ${schema}.user_operations u WHERE u.intent_id=i.id AND u.wallet=$1 AND u.canonical=TRUE))
        AND ($3::timestamptz IS NULL OR (i.created_at,i.id)<($3::timestamptz,$4::uuid))
        ORDER BY i.created_at DESC,i.id DESC LIMIT $5`,[wallet?.toLowerCase()??null,admin,after?.[0]??null,after?.[1]??null,limit+1])
      const page=rows.rows.slice(0,limit)
      return {jobs:await Promise.all(page.map(row=>getIntent(row.id))),nextCursor:rows.rows.length>limit?deploymentCursor(page.at(-1)):null}
    },
    async hasPositionHistory(id,wallet){return Boolean((await query(`SELECT 1 FROM ${schema}.user_operations WHERE intent_id=$1 AND wallet=$2 AND canonical=TRUE LIMIT 1`,[id,wallet.toLowerCase()])).rowCount)},
    async positionsUpdating(){return Boolean((await query(`SELECT 1 FROM ${schema}.vault_jobs j LEFT JOIN ${schema}.vault_observations o ON o.intent_id=j.intent_id
      WHERE j.plan ? 'vault' AND (o.snapshot->>'positionsComplete' IS DISTINCT FROM 'true' OR o.snapshot->>'verified' IS DISTINCT FROM 'true') LIMIT 1`)).rowCount)},
    async reconcileFunding(id,snapshot,actor='observer',client) {
      if (!snapshot?.verified || !snapshot.canonical || now()-snapshot.checkedAt>15_000) return
      const current=await getIntent(id,client)
      if(!current || current.plan.vault?.toLowerCase()!==snapshot.vault?.toLowerCase()) throw fault(409,'Observation does not match the deployment.')
      const reconcile=async client=>{
        await lockBudget(client,current.budget_pool_id)
        const reservation=(await client.query(`SELECT * FROM ${schema}.budget_reservations WHERE intent_id=$1 FOR UPDATE`,[id])).rows[0]
        if(BigInt(reservation.released_raw)>0n) return
        const premium=BigInt(reservation.premium_raw)
        if(BigInt(snapshot.variableCapacity)!==premium) throw fault(409,'Observed premium differs from the reservation.')
        const funded=snapshot.isStarted?premium:[BigInt(snapshot.variableSupply),BigInt(snapshot.variableBalance),premium].reduce((a,b)=>a<b?a:b)
        const delta=funded-BigInt(reservation.allocated_raw)
        if(delta!==0n){
          await client.query(`UPDATE ${schema}.budget_reservations SET allocated_raw=$2,reserved_raw=premium_raw-$2 WHERE intent_id=$1`,[id,funded.toString()])
          await client.query(`UPDATE ${schema}.budget_pools SET allocated_raw=allocated_raw+$2,reserved_raw=reserved_raw-$2 WHERE id=$1`,[current.budget_pool_id,delta.toString()])
          await entry(client,{budgetId:current.budget_pool_id,intentId:id,kind:'observe-funding',allocated:delta,reserved:-delta,actor,
            evidence:{blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash,isStarted:snapshot.isStarted,variableSupply:snapshot.variableSupply}})
        }
        if(snapshot.isStarted) await client.query(`UPDATE ${schema}.deployment_intents SET status='active',updated_at=NOW() WHERE id=$1 AND status<>'completed'`,[id])
      }
      return client?reconcile(client):transaction(reconcile)
    },
    async auditBudget(id) {
      return transaction(async client=>{
        const budget=await lockBudget(client,id)
        const totals=(await client.query(`SELECT COALESCE(sum(limit_delta),0)::text AS limit,COALESCE(sum(reserved_delta),0)::text AS reserved,
          COALESCE(sum(allocated_delta),0)::text AS allocated FROM ${schema}.budget_entries WHERE budget_pool_id=$1`,[id])).rows[0]
        const reservations=(await client.query(`SELECT COALESCE(sum(reserved_raw),0)::text AS reserved,COALESCE(sum(allocated_raw),0)::text AS allocated
          FROM ${schema}.budget_reservations WHERE budget_pool_id=$1`,[id])).rows[0]
        const held=await db.rawHolds(client,id)
        const valid=totals.limit===budget.limit_raw && totals.reserved===budget.reserved_raw && totals.allocated===budget.allocated_raw
          && reservations.reserved===budget.reserved_raw && reservations.allocated===budget.allocated_raw
        if(!valid) await client.query(`UPDATE ${schema}.budget_pools SET reconciliation_required=TRUE WHERE id=$1`,[id])
        return {valid,budget:asBudget({...budget,held_raw:held}),totals}
      })
    },
  }
  Object.assign(db,createCheckoutReservations(db))
  Object.assign(db,createPaymentResolutions(db))
  Object.assign(db,createIntakePolicy(db))
  db.execution=createExecutionDatabase(db)
  return db
}
