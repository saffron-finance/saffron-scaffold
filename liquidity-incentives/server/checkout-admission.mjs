import { randomBytes,createHash } from 'node:crypto'
import { fault } from '../shared/incentives.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')

/** Browser capabilities recover quotes; they impose no request quota and prove no wallet ownership. */
export function createCheckoutAdmission({database:db,origin,basePath='',now=Date.now}){
  const name='saffron_checkout_'+hash((origin??'')+basePath).slice(0,8)
  const token=req=>(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)
  async function identify(req){
    const value=token(req)
    if(!/^[0-9a-f]{64}$/.test(value??''))return null
    const id=hash(value)
    return (await db.query('SELECT 1 FROM saffron_incentives.checkout_clients WHERE id=$1 AND expires_at>$2',[id,new Date(now())])).rowCount?id:null
  }
  return {
    async require(req){const id=await identify(req);if(!id)throw fault(403,'Refresh checkout before requesting payment terms.');return id},
    async issue(req,res){
      if(await identify(req))return {ready:true}
      const value=randomBytes(32).toString('hex'),peer=hash(req.socket.remoteAddress??'unknown')
      await db.transaction(async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-checkout-clients',0))")
        await client.query('INSERT INTO saffron_incentives.checkout_clients(id,peer_hash,expires_at) VALUES($1,$2,$3)',[hash(value),peer,new Date(now()+86400_000)])
      })
      res.setHeader('Set-Cookie',`${name}=${value}; HttpOnly; SameSite=Strict; Path=${basePath}/api/incentives; Max-Age=86400${origin?.startsWith('https:')?'; Secure':''}`)
      return {ready:true}
    },
  }
}
