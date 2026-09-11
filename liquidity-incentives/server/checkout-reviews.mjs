import { randomUUID } from 'node:crypto'
import { fault,digest } from '../shared/incentives.mjs'
const s='saffron_incentives',uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const publicRow=row=>row?{id:row.id,programId:row.program_id,principalCents:row.principal_cents,state:row.state,expiresAt:new Date(row.expires_at).toISOString(),revision:row.revision}:null

/** Larger amounts enter an unpaid operator review. Approval permits one exact
 * checkout to exceed public size/share limits, never economic or queue limits. */
export function createCheckoutReviews(db){return {
  async checkoutReview(clientHash,requestKey,recoveryHash,client=db){
    const row=(await client.query(`SELECT * FROM ${s}.checkout_reviews WHERE client_hash=$1 AND request_key=$2`,[clientHash,requestKey])).rows[0]
    if(row&&row.recovery_hash!==recoveryHash)throw fault(403,'The private checkout recovery record is required.')
    return row??null
  },
  async requestCheckoutReview(input){
    if(!input.clientHash||!uuid.test(input.requestKey??'')||!/^0x[0-9a-f]{64}$/i.test(input.recoveryHash??''))throw fault(400,'Save a private checkout record before requesting review.')
    return db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
      await client.query(`UPDATE ${s}.checkout_reviews SET state='expired',revision=revision+1 WHERE state IN ('pending','approved') AND expires_at<=$1`,[new Date(db.now())])
      const old=await db.checkoutReview(input.clientHash,input.requestKey,input.recoveryHash,client)
      if(old){if(old.wallet!==input.wallet||old.program_id!==input.programId||old.principal_cents!==input.principalCents)throw fault(409,'Resume the original amount review.');return publicRow(old)}
      const rate=(await client.query(`SELECT count(*) FILTER(WHERE state IN ('pending','approved'))::int pending,
        count(*) FILTER(WHERE client_hash=$1 AND state IN ('pending','approved'))::int own,
        count(*) FILTER(WHERE created_at>$2)::int recent FROM ${s}.checkout_reviews`,[input.clientHash,new Date(db.now()-300000)])).rows[0]
      if(rate.pending>=100||rate.own>=1||rate.recent>=100)throw fault(429,'Amount review slots are occupied. No payment is required.')
      const row=(await client.query(`INSERT INTO ${s}.checkout_reviews(id,client_hash,request_key,recovery_hash,wallet,program_id,principal_cents,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),input.clientHash,input.requestKey,input.recoveryHash,input.wallet,input.programId,input.principalCents,new Date(db.now()+86400000)])).rows[0]
      return publicRow(row)
    })
  },
  async listCheckoutReviews({cursor=null,limit=25}={}){
    limit=Number(limit);if(!Number.isInteger(limit)||limit<1||limit>100||cursor&&!uuid.test(cursor))throw fault(400,'Invalid amount review page.')
    const rows=(await db.query(`SELECT id,wallet,program_id,principal_cents,state,revision,expires_at,created_at FROM ${s}.checkout_reviews
      WHERE state IN ('pending','approved') AND expires_at>$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,[new Date(db.now()),cursor,limit+1])).rows
    return {reviews:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null}
  },
  async decideCheckoutReview(id,input,actor){
    if(!uuid.test(id)||!uuid.test(input.requestKey??'')||!Number.isInteger(input.revision)||!['approve','decline'].includes(input.action)||typeof input.reason!=='string'||input.reason.trim().length<8)throw fault(400,'Provide an amount review decision, revision and reason.')
    const fingerprint=digest({id,...input})
    return db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
      const replay=(await client.query(`SELECT fingerprint,result FROM ${s}.checkout_review_audit WHERE actor=$1 AND request_key=$2`,[actor,input.requestKey])).rows[0]
      if(replay){if(replay.fingerprint!==fingerprint)throw fault(409,'Review decision changed.');return replay.result}
      const row=(await client.query(`SELECT * FROM ${s}.checkout_reviews WHERE id=$1 FOR UPDATE`,[id])).rows[0]
      if(!row||row.revision!==input.revision||row.state!=='pending'||row.expires_at.getTime()<=db.now())throw fault(409,'Amount review changed or expired.')
      const result=(await client.query(`UPDATE ${s}.checkout_reviews SET state=$2,revision=revision+1,expires_at=$3 WHERE id=$1 RETURNING *`,[id,input.action==='approve'?'approved':'declined',new Date(db.now()+900000)])).rows[0]
      await client.query(`INSERT INTO ${s}.checkout_review_audit(review_id,actor,request_key,fingerprint,reason,result) VALUES($1,$2,$3,$4,$5,$6)`,[id,actor,input.requestKey,fingerprint,input.reason.trim(),publicRow(result)])
      return publicRow(result)
    })
  },
  async useCheckoutReview(client,{clientHash,requestKey,recoveryHash,wallet,programId,principalCents}){
    if(!clientHash)return null
    const row=await db.checkoutReview(clientHash,requestKey,recoveryHash,client)
    if(!row)return null
    if(row.wallet!==wallet||row.program_id!==programId||row.principal_cents!==principalCents||row.state!=='approved'||row.expires_at.getTime()<=db.now())throw fault(409,'This amount review is pending, closed or expired. No creation fee is due.')
    await client.query(`UPDATE ${s}.checkout_reviews SET state='used',revision=revision+1 WHERE id=$1`,[row.id])
    return row.id
  },
}}
