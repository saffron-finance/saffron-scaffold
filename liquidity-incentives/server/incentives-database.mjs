import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createExecutionDatabase } from './execution-database.mjs'
import { verifyTypedData } from 'viem'
import { CHAIN_ID, FACTORY, normalizePair, normalizeProgram, normalizeBudget, validAddress, integer,
  digest, deploymentTypedData, snapshotFor, jsonSafe, fault } from '../shared/incentives.mjs'

const schema = 'saffron_incentives'
const conflict = () => fault(409, 'This row changed. Refresh before saving.')
const asBudget = row => ({ id: row.id, revision: row.revision, name: row.name, chainId: row.chain_id, rewardAsset: row.reward_asset,
  decimals: row.decimals, limitRaw: row.limit_raw, reservedRaw: row.reserved_raw, allocatedRaw: row.allocated_raw,
  availableRaw: (BigInt(row.limit_raw) - BigInt(row.reserved_raw) - BigInt(row.allocated_raw)).toString(),
  paused: row.paused, reconciliationRequired: row.reconciliation_required })

/** All acceptance/accounting mutations use real SQL transactions. No RPC occurs under a row lock. */
export function createIncentivesDatabase({ connection, now = Date.now, maxPendingPerWallet = 3, maxPending = 100,
  reservationMs = 15 * 60_000, quoteMs = 120_000 } = {}) {
  const pool = new pg.Pool({ ...connection, max: 8, options: '-c timezone=UTC' })
  // pg removes a failed idle client. Subsequent requests reconnect; the HTTP
  // boundary returns generic failures rather than crashing/logging provider data.
  pool.on('error',()=>{})
  const ready = readFile(new URL('./incentives.sql', import.meta.url), 'utf8').then(async sql => {
    const client=await pool.connect()
    try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-incentives-schema',0))");await client.query(sql);await client.query('COMMIT')}
    catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  })
  ready.catch(() => {})
  const query = async (sql, values = []) => { await ready; return pool.query(sql, values) }
  async function transaction(run) {
    await ready
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
  const db = {
    pool, ready, query, transaction, lockBudget, entry, getIntent, now,
    close: () => pool.end(),
    async catalog(admin = false) {
      return transaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const pairs = (await client.query(`SELECT body FROM ${schema}.pairs ORDER BY id`)).rows.map(row => row.body)
        const programs = (await client.query(`SELECT body FROM ${schema}.programs ORDER BY (body->>'sortOrder')::int,id`)).rows.map(row => row.body)
        const budgets = (await client.query(`SELECT * FROM ${schema}.budget_pools ORDER BY id`)).rows.map(asBudget)
        if (admin) return { pairs, programs, budgets }
        const offers = programs.filter(p => p.active).flatMap(p => {
          const pair = pairs.find(row => row.id === p.pairId && row.active), budget = budgets.find(row => row.id === p.budgetPoolId)
          return pair && budget ? [{ ...pair, ...p, pairId: pair.id, pairRevision: pair.revision, capacityUsd: Number(p.maximumCents) / 100, budget }] : []
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
        const values = [value.id,value.name,value.rewardAsset,value.decimals,value.limitRaw,value.paused,actor]
        const result = previous
          ? await client.query(`UPDATE ${schema}.budget_pools SET name=$2,reward_asset=$3,decimals=$4,limit_raw=$5,paused=$6,revision=revision+1,updated_by=$7,updated_at=NOW() WHERE id=$1 RETURNING *`, values)
          : await client.query(`INSERT INTO ${schema}.budget_pools (id,revision,name,chain_id,reward_asset,decimals,limit_raw,paused,updated_by)
              VALUES ($1,1,$2,4663,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`, values)
        if (!result.rowCount) throw conflict()
        await entry(client,{ key: `budget:${value.id}:${result.rows[0].revision}`, budgetId: value.id, kind: 'adjust-limit',
          limit: BigInt(value.limitRaw) - BigInt(previous?.limit_raw ?? '0'), actor, evidence: { name:value.name,paused:value.paused,revision:result.rows[0].revision } })
        return asBudget(result.rows[0])
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
    async putQuote({ offer, principalCents, wallet, origin, plan, signer }) {
      integer(principalCents,{positive:true}); integer(plan.premium,{positive:true}); integer(plan.liquidity,{positive:true})
      if (!validAddress(wallet) || !validAddress(signer) || new URL(origin).origin !== origin) throw fault(400,'Invalid deployment identity.')
      if (BigInt(principalCents)<BigInt(offer.minimumCents) || BigInt(principalCents)>BigInt(offer.maximumCents)) throw fault(400,'The amount is outside this program\'s vault size limits.')
      if (offer.budget.paused || offer.budget.reconciliationRequired || BigInt(plan.premium)>BigInt(offer.budget.availableRaw)) throw fault(409,'This program has insufficient available funding. Refresh offers.')
      const expiresAt = new Date(Math.min(now()+quoteMs,plan.usdCheckedAt+60_000)).toISOString()
      if (Date.parse(expiresAt)<=now()) throw fault(409,'Prices expired. Request a fresh quote.')
      const snapshot = snapshotFor(offer,principalCents,wallet)
      const body = jsonSafe({ id:randomUUID(),wallet:wallet.toLowerCase(),origin,programId:offer.id,programRevision:offer.revision,pairId:offer.pairId,
        pairRevision:offer.pairRevision,budgetPoolId:offer.budgetPoolId,budgetRevision:offer.budget.revision,principalCents,signer:signer.toLowerCase(),snapshot,plan,expiresAt })
      body.planHash = digest({snapshot,plan:body.plan,signer:body.signer,programRevision:body.programRevision,pairRevision:body.pairRevision,budgetRevision:body.budgetRevision})
      await transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-quote:'||$1,0))",[body.wallet])
        const recent = (await client.query(`SELECT count(*)::int AS count FROM ${schema}.deployment_quotes WHERE wallet=$1 AND created_at>$2`,[body.wallet,new Date(now()-300_000)])).rows[0].count
        if (recent>=30) throw fault(429,'Too many quotes. Retry in a few minutes.')
        await client.query(`INSERT INTO ${schema}.deployment_quotes (id,wallet,program_id,budget_pool_id,body,expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [body.id,body.wallet,body.programId,body.budgetPoolId,body,body.expiresAt])
      })
      return body
    },
    async quote(id) { return (await query(`SELECT body FROM ${schema}.deployment_quotes WHERE id=$1`,[id])).rows[0]?.body ?? null },
    async acceptDeployment({ wallet, quoteId, signature, origin }) {
      const quote = await db.quote(quoteId)
      if (!quote || quote.wallet!==wallet.toLowerCase() || quote.origin!==origin) throw fault(404,'Quote not found for this wallet.')
      let verified=false
      try { verified=await verifyTypedData({...deploymentTypedData(quote),address:quote.wallet,signature}) } catch {}
      if (!verified) throw fault(401,'Invalid deployment authorization.')
      return transaction(async client => {
        // Serializes queue limits across wallets/pools, then locks exact budget accounting.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const budget = await lockBudget(client,quote.budgetPoolId)
        const accepted = (await client.query(`SELECT id FROM ${schema}.deployment_intents WHERE quote_id=$1`,[quoteId])).rows[0]
        if (accepted) return {id:accepted.id,replayed:true}
        const program = (await client.query(`SELECT body FROM ${schema}.programs WHERE id=$1 FOR SHARE`,[quote.programId])).rows[0]?.body
        const pair = (await client.query(`SELECT body FROM ${schema}.pairs WHERE id=$1 FOR SHARE`,[quote.pairId])).rows[0]?.body
        if (Date.parse(quote.expiresAt)<=now()) throw fault(409,'Quote expired. Review a fresh quote.')
        if (!program?.active || !pair?.active || program.revision!==quote.programRevision || pair.revision!==quote.pairRevision
          || budget.revision!==quote.budgetRevision || budget.paused || budget.reconciliation_required) throw fault(409,'Program or funding policy changed. Review a fresh quote.')
        const counts=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE wallet=$1)::int AS wallet
          FROM ${schema}.deployment_intents WHERE status NOT IN ('active','completed','retired')`,[quote.wallet])).rows[0]
        if(counts.total>=maxPending || counts.wallet>=maxPendingPerWallet) throw fault(429,'Deployment queue limit reached. Complete or cancel pending work first.')
        const premium=BigInt(quote.plan.premium)
        if (premium>BigInt(budget.limit_raw)-BigInt(budget.reserved_raw)-BigInt(budget.allocated_raw)) throw fault(409,'Funding capacity was taken by another deployment. Request a fresh quote.')
        const id=randomUUID()
        await client.query(`INSERT INTO ${schema}.deployment_intents (id,quote_id,wallet,budget_pool_id,signature,plan_hash,snapshot,accepted_plan)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,quoteId,quote.wallet,quote.budgetPoolId,signature,quote.planHash,quote.snapshot,quote.plan])
        await client.query(`INSERT INTO ${schema}.budget_reservations (intent_id,budget_pool_id,premium_raw,reserved_raw,expires_at) VALUES ($1,$2,$3,$3,$4)`,
          [id,quote.budgetPoolId,premium.toString(),new Date(now()+reservationMs)])
        await client.query(`UPDATE ${schema}.budget_pools SET reserved_raw=reserved_raw+$2 WHERE id=$1`,[quote.budgetPoolId,premium.toString()])
        await entry(client,{key:`accept:${id}`,budgetId:quote.budgetPoolId,intentId:id,kind:'reserve',reserved:premium,actor:quote.wallet})
        await client.query(`INSERT INTO ${schema}.vault_jobs (intent_id,signer,factory,chain_id,plan) VALUES ($1,$2,$3,$4,$5)`,[id,quote.signer,FACTORY,CHAIN_ID,quote.plan])
        return {id,replayed:false}
      })
    },
    async list({wallet,admin=false,limit=100}={}) {
      const rows=await query(`SELECT id FROM ${schema}.deployment_intents ${admin?'':'WHERE wallet=$1'} ORDER BY created_at DESC LIMIT ${Math.min(200,limit)}`,admin?[]:[wallet?.toLowerCase()])
      return Promise.all(rows.rows.map(row=>getIntent(row.id)))
    },
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
