import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { deploymentPage,deploymentCursor } from './deployment-pagination.mjs'
import { createExecutionDatabase } from './execution-database.mjs'
import { proofHash,paymentData } from './payment-proof.mjs'
import { campaignTerms,campaignPremiumCents } from '../shared/campaign.mjs'
import { CHAIN_ID, FACTORY, normalizePair, normalizeProgram, normalizeBudget, validAddress, integer,
  digest, snapshotFor, jsonSafe, fault, UINT256_MAX, cents } from '../shared/incentives.mjs'

const schema = 'saffron_incentives'
const conflict = () => fault(409, 'This row changed. Refresh before saving.')
const asBudget = row => ({ campaign:row.campaign??null, id: row.id, revision: row.revision, name: row.name, chainId: row.chain_id, rewardAsset: row.reward_asset,
  decimals: row.decimals, limitRaw: row.limit_raw, reservedRaw: row.reserved_raw, allocatedRaw: row.allocated_raw,
  availableRaw: (BigInt(row.limit_raw) - BigInt(row.reserved_raw) - BigInt(row.allocated_raw)).toString(),
  paused: row.paused, reconciliationRequired: row.reconciliation_required })

/** All acceptance/accounting mutations use real SQL transactions. No RPC occurs under a row lock. */
export function createIncentivesDatabase({ connection, now = Date.now, maxPendingPerWallet = 3, maxPending = 100,
  reservationMs = 15 * 60_000, quoteMs = 120_000, initializationRetryMs = 5_000,checkoutPolicy={} } = {}) {
  const checkout={maxQuoteBps:1000,maxHeldBps:2500,maxUnpaid:32,...checkoutPolicy}
  if(!Number.isInteger(checkout.maxQuoteBps)||checkout.maxQuoteBps<1||checkout.maxQuoteBps>5000||!Number.isInteger(checkout.maxHeldBps)||checkout.maxHeldBps<checkout.maxQuoteBps||checkout.maxHeldBps>10000
    ||!Number.isInteger(checkout.maxUnpaid)||checkout.maxUnpaid<1||checkout.maxUnpaid>1000)throw new Error('Invalid checkout admission policy.')
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
    return (await client.query(`SELECT i.*,j.signer,j.factory,j.chain_id,j.state,j.funding_state,j.plan,j.operation,j.funding_max_raw,j.funding_operator,
      j.resume_version,j.funding_round,j.attempts,j.error,j.lease_owner,j.lease_until,j.next_attempt_at,j.intent_id
      FROM ${schema}.deployment_intents i JOIN ${schema}.vault_jobs j ON j.intent_id=i.id WHERE i.id=$1`, [id])).rows[0] ?? null
  }
  /** Derive USD and fixed-side accounting from immutable accepted terms.
   * Reservations and funded capacity are separate; actual LP entry is not inferred
   * from a premium payment. Quote holds protect a wallet while it pays the fee.
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
    const holds=(await client.query(`SELECT q.body FROM ${schema}.deployment_quotes q
      WHERE q.budget_pool_id=$1 AND ($2::uuid IS NULL OR q.id<>$2)
      AND COALESCE((q.body->>'withdrawn')::boolean,FALSE)=FALSE
      AND (q.expires_at>$3 OR EXISTS(SELECT 1 FROM ${schema}.payment_proofs p WHERE p.quote_id=q.id AND p.state<>'refunded'))
      AND NOT EXISTS(SELECT 1 FROM ${schema}.deployment_intents i WHERE i.quote_id=q.id)`,[budget.id,excludeQuote,new Date(now())])).rows
    let held=0n,heldBudget=0n
    for(const {body} of holds){held+=BigInt(body.principalCents);heldBudget+=BigInt(body.plan.premiumCents??campaignPremiumCents(terms,body.principalCents))}
    return {budgetCents:terms.budgetCents,targetCapacityCents:terms.capacityCents,
      fundedBudgetCents:fundedBudget.toString(),reservedBudgetCents:(spent-fundedBudget).toString(),heldBudgetCents:heldBudget.toString(),
      fundedCapacityCents:funded.toString(),reservedCapacityCents:(committed-funded).toString(),heldCapacityCents:held.toString(),
      availableBudgetCents:(BigInt(terms.budgetCents)-spent-heldBudget).toString(),
      availableCapacityCents:(BigInt(terms.capacityCents)-committed-held).toString(),fixedDepositedCents:deposited.toString()}
  }
  async function requireCapacity(client,budget,principal,premium,excludeQuote=null){
    const accounting=await campaignAccounting(client,budget,excludeQuote)
    if(accounting&&(BigInt(principal)>BigInt(accounting.availableCapacityCents)||BigInt(premium)>BigInt(accounting.availableBudgetCents)))
      throw fault(409,'Campaign budget or fixed-side capacity is exhausted. Existing payment records are retained.')
  }
  const db = {
    pool, get ready(){return ready()}, query, transaction, lockBudget, entry, getIntent, now, campaignAccounting,checkout,
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
        const budgets = await Promise.all((await client.query(`SELECT * FROM ${schema}.budget_pools ORDER BY id`)).rows.map(async row=>({...asBudget(row),accounting:await campaignAccounting(client,row)})))
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
        if (previous && BigInt(value.limitRaw) < BigInt(previous.reserved_raw) + BigInt(previous.allocated_raw)) throw fault(409, 'The limit cannot be lower than committed premiums.')
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
        return asBudget(result.rows[0])
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
          minimumCents:cents(input.minimumUsd??'1'),maximumCents:campaign.capacityCents,sortOrder:0,isNew:true,active:true})
        const inserted=await client.query(`INSERT INTO ${schema}.budget_pools(id,revision,name,chain_id,reward_asset,decimals,limit_raw,paused,updated_by,campaign)
          VALUES($1,1,$2,4663,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,[budget.id,budget.name,budget.rewardAsset,budget.decimals,budget.limitRaw,budget.paused,actor,campaign])
        if(!inserted.rowCount)throw fault(409,'Campaign ID already exists. Choose a new ID.')
        await entry(client,{key:'budget:'+budget.id+':1',budgetId:budget.id,kind:'create-campaign',limit:budget.limitRaw,actor,evidence:{campaign}})
        const body={...program,revision:1}
        await client.query(`INSERT INTO ${schema}.programs(id,revision,pair_id,budget_pool_id,body,updated_by) VALUES($1,1,$2,$3,$4,$5)`,[program.id,pair.id,budget.id,body,actor])
        return {campaign,budgetId:budget.id,program:body}
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
    async putQuote({ offer, principalCents, wallet, origin, plan, signer, fee, recoveryHash,clientHash=null,requestKey=null }) {
      integer(principalCents,{positive:true}); integer(plan.premium,{positive:true}); integer(plan.liquidity,{positive:true})
      if (!validAddress(wallet) || !validAddress(signer) || new URL(origin).origin !== origin) throw fault(400,'Invalid deployment identity.')
      if (BigInt(principalCents)<BigInt(offer.minimumCents) || BigInt(principalCents)>BigInt(offer.maximumCents)) throw fault(400,'The amount is outside this program\'s vault size limits.')
      if (offer.budget.paused || offer.budget.reconciliationRequired || BigInt(plan.premium)>BigInt(offer.budget.availableRaw)) throw fault(409,'This program has insufficient available funding. Refresh offers.')
      const expiresAt = new Date(Math.min(now()+quoteMs,plan.usdCheckedAt+60_000,fee?.checkedAt?fee.checkedAt+60_000:Infinity)).toISOString()
      if (Date.parse(expiresAt)<=now()) throw fault(409,'Prices expired. Request a fresh quote.')
      const snapshot = snapshotFor(offer,principalCents,wallet)
      const body = jsonSafe({ fee,recoveryHash,paymentDeadline:expiresAt, id:randomUUID(),wallet:wallet.toLowerCase(),origin,programId:offer.id,programRevision:offer.revision,pairId:offer.pairId,
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
        const locked=await lockBudget(client,body.budgetPoolId)
        if(locked.paused||locked.reconciliation_required||locked.revision!==body.budgetRevision)throw fault(409,'Campaign changed. Refresh before paying.')
        await requireCapacity(client,locked,principalCents,plan.premiumCents??(locked.campaign?campaignPremiumCents(locked.campaign,principalCents):'0'))
        if(locked.campaign){
          const accounting=await campaignAccounting(client,locked),premium=BigInt(plan.premiumCents??campaignPremiumCents(locked.campaign,principalCents))
          if(BigInt(principalCents)*10000n>BigInt(locked.campaign.capacityCents)*BigInt(checkout.maxQuoteBps)
            ||premium*10000n>BigInt(locked.campaign.budgetCents)*BigInt(checkout.maxQuoteBps))throw fault(409,'Choose a smaller amount within this campaign\'s public checkout limit.')
          if((BigInt(accounting.heldCapacityCents)+BigInt(principalCents))*10000n>BigInt(locked.campaign.capacityCents)*BigInt(checkout.maxHeldBps)
            ||(BigInt(accounting.heldBudgetCents)+premium)*10000n>BigInt(locked.campaign.budgetCents)*BigInt(checkout.maxHeldBps))throw fault(429,'The campaign checkout slots are currently occupied. Retry after pending payments settle.')
        }
        const holds=(await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE client_hash=$1)::int browser
          FROM ${schema}.deployment_quotes q WHERE q.expires_at>$2 AND COALESCE((q.body->>'withdrawn')::boolean,FALSE)=FALSE
          AND NOT EXISTS(SELECT 1 FROM ${schema}.deployment_intents i WHERE i.quote_id=q.id)`,[clientHash,new Date(now())])).rows[0]
        if(holds.total>=checkout.maxUnpaid||clientHash&&holds.browser>=1)throw fault(429,'Finish the open checkout or wait for a free checkout slot.')
        const issuance=(await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE client_hash=$1)::int browser
          FROM ${schema}.deployment_quotes WHERE created_at>$2`,[clientHash,new Date(now()-300_000)])).rows[0]
        if(issuance.total>=300||clientHash&&issuance.browser>=10)throw fault(429,'Too many checkout requests. Retry in a few minutes.')
        const recent = (await client.query(`SELECT count(*)::int AS count FROM ${schema}.deployment_quotes WHERE wallet=$1 AND created_at>$2`,[body.wallet,new Date(now()-300_000)])).rows[0].count
        if (recent>=30) throw fault(429,'Too many quotes. Retry in a few minutes.')
        await client.query(`INSERT INTO ${schema}.deployment_quotes (id,wallet,program_id,budget_pool_id,body,expires_at,payment_commitment,client_hash,request_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [body.id,body.wallet,body.programId,body.budgetPoolId,body,new Date(Date.parse(body.expiresAt)+(fee?15*60_000:0)),fee?paymentData(body):null,clientHash,requestKey])
      })
      return resultBody
    },
    async quote(id) { return (await query(`SELECT body FROM ${schema}.deployment_quotes WHERE id=$1`,[id])).rows[0]?.body ?? null },
    /** Release an abandoned unpaid hold using its private browser capability.
     * A payment racing cancellation is retained for operator resolution, never
     * silently admitted after its capacity was given to another request.
     */
    async withdrawQuote(id,secret){
      const quote=await db.quote(id)
      if(!quote||typeof secret!=='string'||proofHash(secret)!==quote.recoveryHash)throw fault(403,'Request recovery record is required.')
      return transaction(async client=>{
        await lockBudget(client,quote.budgetPoolId)
        const paid=await client.query(`SELECT 1 FROM ${schema}.payment_proofs WHERE quote_id=$1`,[id])
        if(paid.rowCount)throw fault(409,'This request has a payment. Recover it instead of discarding it.')
        await client.query(`UPDATE ${schema}.deployment_quotes SET expires_at=$2,body=body||'{"withdrawn":true}'::jsonb WHERE id=$1`,[id,new Date(now())])
        return {withdrawn:true}
      })
    },
    /** Called only with canonical evidence from the payment verifier. */
    async recordPayment(payment){
      if(!payment?.verified)throw fault(400,'Verified payment evidence is required.')
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
      throw fault(409,'A payment was already bound to this request or another request; duplicate evidence is retained.')
    },
    async acceptDeployment({ wallet, quoteId, payment, origin }) {
      const quote = await db.quote(quoteId)
      if (!quote || quote.wallet!==wallet.toLowerCase() || quote.origin!==origin) throw fault(404,'Quote not found for this wallet.')
      if(!payment?.verified||payment.quoteId!==quoteId||payment.wallet!==quote.wallet||payment.planHash!==quote.planHash)throw fault(401,'A matching verified ETH payment is required.')
      await db.recordPayment(payment)
      return transaction(async client => {
        // Serializes queue limits across wallets/pools, then locks exact budget accounting.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const budget = await lockBudget(client,quote.budgetPoolId)
        const accepted = (await client.query(`SELECT id FROM ${schema}.deployment_intents WHERE quote_id=$1`,[quoteId])).rows[0]
        if (accepted) return {id:accepted.id,replayed:true}
        if(quote.withdrawn||payment.late)throw fault(409,'Payment requires operator resolution because the quote was withdrawn or paid late.')
        const program = (await client.query(`SELECT body FROM ${schema}.programs WHERE id=$1 FOR SHARE`,[quote.programId])).rows[0]?.body
        const pair = (await client.query(`SELECT body FROM ${schema}.pairs WHERE id=$1 FOR SHARE`,[quote.pairId])).rows[0]?.body
        // Payment was mined before its deadline; response delay cannot require another fee.
        if (!program?.active || !pair?.active || program.revision!==quote.programRevision || pair.revision!==quote.pairRevision
          || budget.revision!==quote.budgetRevision || budget.paused || budget.reconciliation_required) throw fault(409,'Program or funding policy changed. Review a fresh quote.')
        const counts=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE wallet=$1)::int AS wallet
          FROM ${schema}.deployment_intents WHERE status NOT IN ('active','completed','retired')`,[quote.wallet])).rows[0]
        if(counts.total>=maxPending || counts.wallet>=maxPendingPerWallet) throw fault(429,'Deployment queue limit reached. Complete or cancel pending work first.')
        await requireCapacity(client,budget,quote.principalCents,quote.plan.premiumCents??(budget.campaign?campaignPremiumCents(budget.campaign,quote.principalCents):'0'),quoteId)
        const premium=BigInt(quote.plan.premium)
        if (premium>BigInt(budget.limit_raw)-BigInt(budget.reserved_raw)-BigInt(budget.allocated_raw)) throw fault(409,'Funding capacity was taken by another deployment. Request a fresh quote.')
        const id=randomUUID()
        await client.query(`INSERT INTO ${schema}.deployment_intents (id,quote_id,wallet,budget_pool_id,signature,plan_hash,snapshot,accepted_plan)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,quoteId,quote.wallet,quote.budgetPoolId,null,quote.planHash,quote.snapshot,quote.plan])
        await client.query(`INSERT INTO ${schema}.budget_reservations (intent_id,budget_pool_id,premium_raw,reserved_raw,expires_at) VALUES ($1,$2,$3,$3,$4)`,
          [id,quote.budgetPoolId,premium.toString(),new Date(now()+reservationMs)])
        await client.query(`UPDATE ${schema}.budget_pools SET reserved_raw=reserved_raw+$2 WHERE id=$1`,[quote.budgetPoolId,premium.toString()])
        await entry(client,{key:`accept:${id}`,budgetId:quote.budgetPoolId,intentId:id,kind:'reserve',reserved:premium,actor:quote.wallet})
        await client.query(`INSERT INTO ${schema}.vault_jobs (intent_id,signer,factory,chain_id,plan) VALUES ($1,$2,$3,$4,$5)`,[id,quote.signer,FACTORY,CHAIN_ID,quote.plan])
        await client.query(`UPDATE ${schema}.payment_proofs SET state='fulfilled',error=NULL WHERE quote_id=$1`,[quoteId])
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
    async cancelDeployment(id,wallet,{expiredOnly=false}={}) {
      const current=await getIntent(id)
      if(!current || current.wallet!==wallet.toLowerCase()) throw fault(404,'Deployment not found for this wallet.')
      return transaction(async client=>{
        await lockBudget(client,current.budget_pool_id)
        const job=(await client.query(`SELECT * FROM ${schema}.vault_jobs WHERE intent_id=$1 FOR UPDATE`,[id])).rows[0]
        if(job.state==='retired') return {retired:true}
        const operations=await client.query(`SELECT 1 FROM ${schema}.chain_operations WHERE intent_id=$1 LIMIT 1`,[id])
        const reservation=(await client.query(`SELECT *,expires_at<=NOW() AS expired FROM ${schema}.budget_reservations WHERE intent_id=$1 FOR UPDATE`,[id])).rows[0]
        const leased=job.lease_until && job.lease_until.getTime()>now()
        // The expiry sweep may have selected this row before a lease or journal
        // changed. Recheck while locked without turning expiry into cancellation.
        if(expiredOnly&&(!reservation.expired||operations.rowCount||leased))return {retired:false}
        if(operations.rowCount || leased) {
          await client.query(`UPDATE ${schema}.deployment_intents SET cancel_requested=TRUE,updated_at=NOW() WHERE id=$1`,[id])
          return {retired:false,needsReconciliation:true}
        }
        if(BigInt(reservation.allocated_raw)!==0n) throw fault(409,'Funded premiums require verified recovery.')
        await client.query(`UPDATE ${schema}.budget_pools SET reserved_raw=reserved_raw-$2 WHERE id=$1`,[current.budget_pool_id,reservation.reserved_raw])
        await entry(client,{key:`retire:${id}`,budgetId:current.budget_pool_id,intentId:id,kind:'release-unused',reserved:-BigInt(reservation.reserved_raw),actor:wallet})
        await client.query(`UPDATE ${schema}.budget_reservations SET released_raw=premium_raw,reserved_raw=0 WHERE intent_id=$1`,[id])
        await client.query(`UPDATE ${schema}.vault_jobs SET state='retired',lease_owner=NULL,lease_until=NULL WHERE intent_id=$1`,[id])
        await client.query(`UPDATE ${schema}.deployment_intents SET status='retired',cancel_requested=TRUE,updated_at=NOW() WHERE id=$1`,[id])
        return {retired:true}
      })
    },
    async auditBudget(id) {
      return transaction(async client=>{
        const budget=await lockBudget(client,id)
        const totals=(await client.query(`SELECT COALESCE(sum(limit_delta),0)::text AS limit,COALESCE(sum(reserved_delta),0)::text AS reserved,
          COALESCE(sum(allocated_delta),0)::text AS allocated FROM ${schema}.budget_entries WHERE budget_pool_id=$1`,[id])).rows[0]
        const reservations=(await client.query(`SELECT COALESCE(sum(reserved_raw),0)::text AS reserved,COALESCE(sum(allocated_raw),0)::text AS allocated
          FROM ${schema}.budget_reservations WHERE budget_pool_id=$1`,[id])).rows[0]
        const valid=totals.limit===budget.limit_raw && totals.reserved===budget.reserved_raw && totals.allocated===budget.allocated_raw
          && reservations.reserved===budget.reserved_raw && reservations.allocated===budget.allocated_raw
        if(!valid) await client.query(`UPDATE ${schema}.budget_pools SET reconciliation_required=TRUE WHERE id=$1`,[id])
        return {valid,budget:asBudget(budget),totals}
      })
    },
  }
  db.execution=createExecutionDatabase(db)
  return db
}
