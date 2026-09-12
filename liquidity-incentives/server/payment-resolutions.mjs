import { digest,fault,validAddress } from '../shared/incentives.mjs'
const s='saffron_incentives'
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function createPaymentResolutions(db){
  return {
    async retainPayment(payment,kind=payment.late?'late-fee':'creation-fee'){
      if(!payment?.verified||!/^\d+$/.test(payment.amountWei??'')||BigInt(payment.amountWei)<=0n)throw fault(400,'Received ETH evidence is required.')
      await db.query(`INSERT INTO ${s}.payment_obligations(hash,quote_id,wallet,amount_wei,kind,evidence)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(hash) DO UPDATE SET evidence=EXCLUDED.evidence`,
        [payment.hash,payment.quoteId,payment.wallet,payment.amountWei,kind,payment])
    },
    async paymentAttention(hash,kind){
      await db.query(`UPDATE ${s}.payment_obligations SET state='needs_attention',kind=$2,revision=revision+1,updated_at=NOW()
        WHERE hash=$1 AND state IN ('received','admitted','needs_attention') AND (state<>'needs_attention' OR kind<>$2)`,[hash,kind])
    },
    async paymentObligation(hash,client=db){return (await client.query(`SELECT * FROM ${s}.payment_obligations WHERE hash=$1`,[hash])).rows[0]??null},
    async listPayments({cursor=null,limit=25,wallet=null,all=false}={}){
      limit=Number(limit)
      if(!Number.isInteger(limit)||limit<1||limit>100||cursor&&!/^0x[0-9a-f]{64}$/.test(cursor))throw fault(400,'Invalid payment page.')
      const rows=(await db.query(`SELECT o.hash,o.quote_id,o.wallet,o.amount_wei,o.kind,o.state,o.revision,o.created_at,o.updated_at,i.id AS deployment_id
        FROM ${s}.payment_obligations o LEFT JOIN ${s}.deployment_intents i ON i.quote_id=o.quote_id
        WHERE ($1::text IS NULL OR o.hash>$1) AND ($2::text IS NULL OR o.wallet=$2)
        AND ($3::boolean OR o.state NOT IN ('admitted','refunded')) ORDER BY o.hash LIMIT $4`,[cursor,wallet,all,limit+1])).rows
      return {payments:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].hash:null}
    },
    async resolutionReplay(client,hash,action,resolution,evidence=null){
      if(!resolution||!validAddress(resolution.operator)||!uuid.test(resolution.requestKey??'')||!Number.isInteger(resolution.revision)
        ||typeof resolution.reason!=='string'||resolution.reason.trim().length<3||resolution.reason.length>500)throw fault(400,'Provide the row revision, request key and a resolution reason.')
      const fingerprint=digest({hash,action,revision:resolution.revision,reason:resolution.reason,evidence})
      const previous=(await client.query(`SELECT fingerprint,result FROM ${s}.payment_resolution_audit WHERE actor=$1 AND request_key=$2`,[resolution.operator,resolution.requestKey])).rows[0]
      if(previous&&previous.fingerprint!==fingerprint)throw fault(409,'Resolution request key was already used for different terms.')
      return {fingerprint,replayed:previous?.result??null}
    },
    async auditPaymentResolution(client,hash,action,resolution,fingerprint,result,evidence=null){
      await client.query(`INSERT INTO ${s}.payment_resolution_audit(payment_hash,actor,request_key,action,reason,expected_revision,fingerprint,evidence,result)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[hash,resolution.operator,resolution.requestKey,action,resolution.reason,resolution.revision,fingerprint,evidence,result])
    },
  }
}
