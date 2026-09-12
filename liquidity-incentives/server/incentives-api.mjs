import { decodeFunctionResult,encodeFunctionData,parseAbi } from 'viem'
import { fault,normalizePair,validAddress } from '../shared/incentives.mjs'
import { proofHash,paymentData } from '../shared/payment.mjs'
import { createCheckoutAdmission } from './checkout-admission.mjs'
import { createPairDiscovery } from './pair-discovery.mjs'

export function sendJson(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))}
async function readBody(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw fault(415,'JSON required.')
  let size=0;const chunks=[]
  for await(const chunk of req){size+=chunk.length;if(size>32768)throw fault(413,'Request is too large.');chunks.push(chunk)}
  try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body}
  catch{throw fault(400,'Invalid JSON object.')}
}
const poolAbi=parseAbi(['function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function decimals() view returns(uint8)'])
export async function verifyPair(pair,rpc){
  if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw fault(503,'Robinhood RPC is unavailable.')
  const block=await rpc('eth_blockNumber',[])
  const read=async(address,name)=>decodeFunctionResult({abi:poolAbi,functionName:name,data:await rpc('eth_call',[{to:address,data:encodeFunctionData({abi:poolAbi,functionName:name})},block])})
  const [a,b,fee,decimals0,decimals1]=await Promise.all([read(pair.pool,'token0'),read(pair.pool,'token1'),read(pair.pool,'fee'),read(pair.token0.address,'decimals'),read(pair.token1.address,'decimals')])
  if(![a.toLowerCase(),b.toLowerCase()].every(address=>[pair.token0.address,pair.token1.address].includes(address))||Number(fee)!==pair.feeTier||Number(decimals0)!==pair.token0.decimals||Number(decimals1)!==pair.token1.decimals)throw fault(400,'Pool and token metadata do not match the chain.')
}
export function createIncentivesHandler({database:db,auth,service,rpc,configuration,health,basePath='',now=Date.now}){
  const root=basePath+'/api/incentives',windows=new Map()
  const checkout=createCheckoutAdmission({database:db,origin:auth.origin,basePath,now})
  const discovery=createPairDiscovery({rpc,now})
  return async(req,res,pathname)=>{
    if(pathname!==root&&!pathname.startsWith(root+'/'))return false
    try{
      if(!db)throw fault(503,'The incentives database is not configured.')
      const path=pathname.slice(root.length),method=req.method
      const page=()=>{
        const params=new URL(req.url,'http://localhost').searchParams
        return {cursor:params.get('cursor'),...(params.has('limit')?{limit:params.get('limit')}:{})}
      }
      // Only the trusted direct peer is used; public proxies enforce per-client limits.
      const key=req.socket.remoteAddress??'local',current=windows.get(key)
      if(!current||current.until<=now()){for(const [id,w]of windows)if(w.until<=now())windows.delete(id);windows.set(key,{count:1,until:now()+60_000})}
      else if(++current.count>600)throw fault(429,'Too many requests. Retry shortly.')
      if(method==='GET'&&path==='/programs'){sendJson(res,200,await service.programs());return true}
      if(method==='GET'&&path==='/payments'){
        const wallet=new URL(req.url,'http://localhost').searchParams.get('wallet')
        if(!validAddress(wallet))throw fault(400,'Provide a valid wallet.')
        sendJson(res,200,await db.listPayments({...page(),wallet:wallet.toLowerCase(),all:true}));return true
      }
      if(method==='GET'&&path==='/session'){
        let session=null;try{session=auth.session(req)}catch(error){if(error.status!==401)throw error}
        sendJson(res,200,{session});return true
      }
      if(!['GET','POST'].includes(method))throw fault(405,'Method not allowed.')
      const body=method==='POST'?await readBody(req):null
      if(method==='POST'&&path==='/checkout/session'){auth.checkOrigin(req);sendJson(res,200,await checkout.issue(req,res));return true}
      if(method==='POST'&&path==='/checkout/recover'){
        auth.checkOrigin(req)
        const quote=await db.checkoutQuote(await checkout.require(req),body.requestKey)
        if(quote&&(typeof body.recoverySecret!=='string'||proofHash(body.recoverySecret)!==quote.recoveryHash))throw fault(403,'Request recovery record is required.')
        sendJson(res,200,{quote:quote?{...quote,paymentData:paymentData(quote)}:null});return true
      }
      if(method==='POST'&&path==='/session/challenge'){sendJson(res,200,auth.challenge(req,body.wallet));return true}
      if(method==='POST'&&path==='/session/login'){sendJson(res,200,{session:await auth.login(req,res,body)});return true}
      if(method==='POST'&&path==='/deployment-quotes/withdraw'){
        auth.checkOrigin(req);sendJson(res,200,await db.withdrawQuote(body.quoteId,body.recoverySecret));return true
      }
      if(method==='POST'&&path==='/payments/recover'){
        auth.checkOrigin(req)
        const result=await service.recoverPayment(body.quoteId,body.recoverySecret)
        sendJson(res,200,{...result,...(result.deployment?{session:auth.grantPayment(req,res,result.wallet)}:{})});return true
      }
      // Public-user consent is the quoted ETH transaction; no message login.
      if(method==='POST'&&['/deployment-quotes','/deployments','/session/payment'].includes(path)){
        auth.checkOrigin(req)
        if(path==='/deployment-quotes'){
          if(!validAddress(body.wallet))throw fault(400,'Connect a valid wallet.')
          sendJson(res,200,{quote:await service.quote(body.wallet,body.programId,body.amountUsd,body.recoveryHash,{clientHash:await checkout.require(req),requestKey:body.requestKey})});return true
        }
        if(path==='/session/payment'){
          const proof=await service.paymentProof(body.quoteId,body.paymentHash,body.recoverySecret)
          sendJson(res,200,{session:auth.grantPayment(req,res,proof.wallet)});return true
        }
        const accepted=await service.acceptPayment(body.quoteId,body.paymentHash,body.recoverySecret)
        const session=auth.grantPayment(req,res,accepted.wallet)
        sendJson(res,accepted.replayed?200:201,{...accepted,session,deployment:await service.detail(accepted.id,accepted.wallet,false,{fresh:false})});return true
      }
      // Public position reads do not authenticate mutations. The connected wallet
      // proves action ownership when it sends deposit/claim/withdraw on chain.
      const viewer=new URL(req.url,'http://localhost').searchParams.get('wallet')
      let session
      if(method==='GET'&&(path==='/deployments'||path==='/positions'||path.startsWith('/deployments/'))&&validAddress(viewer))session={wallet:viewer.toLowerCase(),operator:false}
      else if(method==='POST'&&/^\/deployments\/[^/]+\/transactions$/.test(path)&&validAddress(body.wallet)){
        auth.checkOrigin(req);session={wallet:body.wallet.toLowerCase(),operator:false}
      }else session=auth.session(req,{mutation:method==='POST',operator:path.startsWith('/admin/')})
      if(method==='POST'&&path==='/session/logout'){auth.logout(req,res);sendJson(res,200,{success:true});return true}
      if(method==='GET'&&['/deployments','/positions'].includes(path)){sendJson(res,200,await service.list(session.wallet,false,page()));return true}
      const deployment=/^\/deployments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(context|transactions))?$/.exec(path)
      if(deployment){
        if(method==='POST'&&deployment[2]==='transactions'){sendJson(res,200,await service.recordUserAction(deployment[1],session.wallet,body.hash));return true}
        if(method==='GET'&&!deployment[2]){sendJson(res,200,{deployment:await service.detail(deployment[1],session.wallet)});return true}
        if(method==='GET'&&deployment[2]==='context'){sendJson(res,200,await service.context(deployment[1],session.wallet));return true}
        throw fault(405,'Method not allowed.')
      }
      if(method==='GET'&&path==='/admin/catalog'){sendJson(res,200,await db.catalog(true));return true}
      // Independent of database queries and checkout health: configuration
      // warnings remain available during an outage, behind the same wallet gate.
      if(method==='GET'&&path==='/admin/configuration'){
        if(!configuration)throw fault(503,'Configuration checks are unavailable.')
        sendJson(res,200,configuration());return true
      }
      if(method==='GET'&&path==='/admin/health'){
        if(!health)throw fault(503,'Operational checks are unavailable.')
        sendJson(res,200,await health());return true
      }
      // These reads still require a wallet-authenticated operator session above.
      if(method==='GET'&&path==='/admin/tokens'){sendJson(res,200,await discovery.tokens());return true}
      const tokenAddress=/^\/admin\/tokens\/(0x[0-9a-fA-F]{40})$/.exec(path)
      if(method==='GET'&&tokenAddress){sendJson(res,200,await discovery.token(tokenAddress[1]));return true}
      if(method==='GET'&&path==='/admin/pools'){
        const params=new URL(req.url,'http://localhost').searchParams
        sendJson(res,200,await discovery.pools(params.get('token0'),params.get('token1')));return true
      }
      if(method==='GET'&&path==='/admin/status'){sendJson(res,200,await service.operatorStatus());return true}
      if(method==='GET'&&path==='/admin/portfolio-capacity'){sendJson(res,200,await service.capacityAdvisory());return true}
      if(method==='POST'&&path==='/admin/intake'){
        const status=await service.operatorStatus()
        if(body.signer?.toLowerCase()!==status.signer?.toLowerCase())throw fault(400,'Intake must use the configured creation signer.')
        sendJson(res,200,{policy:await db.saveIntake(body,session.wallet),readiness:await service.readiness()});return true
      }
      if(method==='GET'&&path==='/admin/deployments'){sendJson(res,200,await service.list(session.wallet,true,page()));return true}
      if(method==='POST'&&path==='/admin/campaigns'){sendJson(res,201,await db.saveCampaign(body,session.wallet));return true}
      if(method==='GET'&&path==='/admin/payments'){sendJson(res,200,await db.listPayments({...page(),all:new URL(req.url,'http://localhost').searchParams.get('all')==='true'}));return true}
      if(method==='GET'&&path==='/admin/refunds'){sendJson(res,200,await service.refunds.list());return true}
      if(method==='POST'&&path==='/admin/refunds/prepare'){sendJson(res,201,await service.refunds.prepare(body,session.wallet));return true}
      const refundBatch=/^\/admin\/refunds\/([0-9a-f-]{36})(?:\/(submit|remainder))?$/.exec(path)
      if(refundBatch){
        if(method==='GET'&&!refundBatch[2])sendJson(res,200,await service.refunds.detail(refundBatch[1]))
        else if(method==='POST'&&refundBatch[2]==='submit')sendJson(res,200,await service.refunds.submit(refundBatch[1],body.hashes,session.wallet))
        else if(method==='POST'&&refundBatch[2]==='remainder')sendJson(res,200,await service.refunds.remainder(refundBatch[1],session.wallet))
        else throw fault(405,'Method not allowed.')
        return true
      }
      const approveRefund=/^\/admin\/payments\/(0x[0-9a-f]{64})\/refund$/.exec(path)
      if(method==='POST'&&approveRefund){sendJson(res,200,await service.refunds.approve(approveRefund[1],{...body,operator:session.wallet},body));return true}
      const paymentAudit=/^\/admin\/payments\/(0x[0-9a-f]{64})\/audit$/.exec(path)
      if(method==='GET'&&paymentAudit){sendJson(res,200,{audit:(await db.query('SELECT actor,action,reason,expected_revision,evidence,result,created_at FROM saffron_incentives.payment_resolution_audit WHERE payment_hash=$1 ORDER BY id',[paymentAudit[1]])).rows});return true}
      const paymentAction=/^\/admin\/payments\/(0x[0-9a-f]{64})\/(admit)$/.exec(path)
      if(method==='POST'&&paymentAction){
        const resolution={operator:session.wallet,revision:body.revision,requestKey:body.requestKey,reason:body.reason}
        sendJson(res,200,await service.admitOriginalPayment(paymentAction[1],resolution));return true
      }
      if(method==='POST'&&path==='/admin/pairs'){const pair=normalizePair(body);await verifyPair(pair,rpc);sendJson(res,200,{pair:await db.savePair(pair,session.wallet)});return true}
      if(method==='POST'&&path==='/admin/programs'){sendJson(res,200,{program:await db.saveProgram(body,session.wallet)});return true}
      if(method==='POST'&&path==='/admin/budgets'){sendJson(res,200,{budget:await db.saveBudget(body,session.wallet)});return true}
      const advisory=/^\/admin\/budgets\/([a-z0-9-]+)\/advisory$/.exec(path)
      if(method==='POST'&&advisory){sendJson(res,200,await db.saveAdvisoryBudget(advisory[1],body,session.wallet));return true}
      const budgetAction=/^\/admin\/budgets\/([a-z0-9-]+)\/reconcile$/.exec(path)
      if(method==='POST'&&budgetAction){sendJson(res,200,{budget:await service.reconcileBudget(budgetAction[1],session.wallet)});return true}
      const operation=/^\/admin\/deployments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(resume|reconcile)$/.exec(path)
      if(method==='POST'&&operation){
        if(operation[2]==='reconcile')await service.reconcileTransaction(operation[1],session.wallet,body.originalHash,body.hash)
        else await db.execution.approveOperation(operation[1],session.wallet,body.planHash,operation[2])
        sendJson(res,200,{deployment:await service.detail(operation[1],session.wallet,true,{fresh:false})});return true
      }
      throw fault(404,'Endpoint not found.')
    }catch(error){const known=[400,401,403,404,405,409,413,415,429,503].includes(error.status);sendJson(res,known?error.status:503,{error:known?error.message:'Incentives are unavailable. Your accepted deployment remains saved.'})}
    return true
  }
}
