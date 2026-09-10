import { decodeFunctionResult,encodeFunctionData,parseAbi } from 'viem'
import { fault,normalizePair,validAddress } from '../shared/incentives.mjs'

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
export function createIncentivesHandler({database:db,auth,service,rpc,basePath='',now=Date.now}){
  const root=basePath+'/api/incentives',windows=new Map()
  return async(req,res,pathname)=>{
    if(pathname!==root&&!pathname.startsWith(root+'/'))return false
    try{
      if(!db)throw fault(503,'The incentives database is not configured.')
      const path=pathname.slice(root.length),method=req.method
      // Only the trusted direct peer is used; public proxies enforce per-client limits.
      const key=req.socket.remoteAddress??'local',current=windows.get(key)
      if(!current||current.until<=now()){for(const [id,w]of windows)if(w.until<=now())windows.delete(id);windows.set(key,{count:1,until:now()+60_000})}
      else if(++current.count>600)throw fault(429,'Too many requests. Retry shortly.')
      if(method==='GET'&&path==='/programs'){sendJson(res,200,await service.programs());return true}
      if(method==='GET'&&path==='/session'){
        let session=null;try{session=auth.session(req)}catch(error){if(error.status!==401)throw error}
        sendJson(res,200,{session});return true
      }
      if(!['GET','POST'].includes(method))throw fault(405,'Method not allowed.')
      const body=method==='POST'?await readBody(req):null
      if(method==='POST'&&path==='/session/challenge'){sendJson(res,200,auth.challenge(req,body.wallet));return true}
      if(method==='POST'&&path==='/session/login'){sendJson(res,200,{session:await auth.login(req,res,body)});return true}
      const session=auth.session(req,{mutation:method==='POST',operator:path.startsWith('/admin/')})
      if(method==='POST'&&path==='/session/logout'){auth.logout(req,res);sendJson(res,200,{success:true});return true}
      if(method==='GET'&&['/deployments','/positions'].includes(path)){sendJson(res,200,await service.list(session.wallet));return true}
      if(method==='POST'&&path==='/deployment-quotes'){sendJson(res,200,{quote:await service.quote(session.wallet,body.programId,body.amountUsd)});return true}
      if(method==='POST'&&path==='/deployments'){
        if(typeof body.quoteId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.quoteId)||typeof body.signature!=='string'||body.signature.length>2048)throw fault(400,'Invalid deployment authorization.')
        const accepted=await db.acceptDeployment({wallet:session.wallet,quoteId:body.quoteId,signature:body.signature,origin:auth.origin})
        sendJson(res,accepted.replayed?200:201,{...accepted,deployment:await service.detail(accepted.id,session.wallet,false,{fresh:false})});return true
      }
      const deployment=/^\/deployments\/([0-9a-f-]{36})(?:\/(context|cancel))?$/.exec(path)
      if(deployment){
        if(method==='POST'&&deployment[2]==='cancel'){sendJson(res,200,await db.cancelDeployment(deployment[1],session.wallet));return true}
        if(method==='GET'&&!deployment[2]){sendJson(res,200,{deployment:await service.detail(deployment[1],session.wallet)});return true}
        if(method==='GET'&&deployment[2]==='context'){sendJson(res,200,await service.context(deployment[1],session.wallet));return true}
        throw fault(405,'Method not allowed.')
      }
      if(method==='GET'&&path==='/admin/catalog'){sendJson(res,200,await db.catalog(true));return true}
      if(method==='GET'&&path==='/admin/deployments'){sendJson(res,200,await service.list(session.wallet,true));return true}
      if(method==='POST'&&path==='/admin/pairs'){const pair=normalizePair(body);await verifyPair(pair,rpc);sendJson(res,200,{pair:await db.savePair(pair,session.wallet)});return true}
      if(method==='POST'&&path==='/admin/programs'){sendJson(res,200,{program:await db.saveProgram(body,session.wallet)});return true}
      if(method==='POST'&&path==='/admin/budgets'){sendJson(res,200,{budget:await db.saveBudget(body,session.wallet)});return true}
      const budgetAction=/^\/admin\/budgets\/([a-z0-9-]+)\/reconcile$/.exec(path)
      if(method==='POST'&&budgetAction){sendJson(res,200,{budget:await service.reconcileBudget(budgetAction[1],session.wallet)});return true}
      const operation=/^\/admin\/deployments\/([0-9a-f-]{36})\/(fund|resume|retire|collect|reconcile)$/.exec(path)
      if(method==='POST'&&operation){
        if(operation[2]==='reconcile')await service.reconcileTransaction(operation[1],session.wallet,body.originalHash,body.hash)
        else if(operation[2]==='fund')await service.fund(operation[1],session.wallet,body.planHash,body.maximumRaw)
        else await db.execution.approveOperation(operation[1],session.wallet,body.planHash,operation[2])
        sendJson(res,200,{deployment:await service.detail(operation[1],session.wallet,true,{fresh:false})});return true
      }
      throw fault(404,'Endpoint not found.')
    }catch(error){const known=[400,401,403,404,405,409,413,415,429,503].includes(error.status);sendJson(res,known?error.status:503,{error:known?error.message:'Incentives are unavailable. Your accepted deployment remains saved.'})}
    return true
  }
}
