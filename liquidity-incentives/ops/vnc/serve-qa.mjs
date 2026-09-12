/** Authenticated-edge QA shell, served only on loopback. It owns no wallet key,
 * chain RPC or database connection. Bounded commands go to the dedicated local
 * disposable fixture's root-only socket. Position status is read from that same
 * fixture's loopback API only; deployed production APIs are never proxied here.
 */
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { readFile } from 'node:fs/promises'
import { withPositionStatus } from './qa-status.mjs'
import { browserStatus,reopenBrowser } from './qa-browser.mjs'
import { createHostResetController } from './qa-reset-host.mjs'

import { settings } from './config.mjs'
const prefix=settings.prefix
const document=(await readFile(new URL('./qa.html',import.meta.url),'utf8')).replaceAll('/saffron/apps/vault-watcher-test',prefix)
const commandSet=new Set(['fund-half','fund','mature','reopen','reset'])
let actionPending=false
const resets=await createHostResetController(async()=>{
  const payload=await command('status',2500)
  if(!payload.ok)throw Error('Test status unavailable')
  return payload.result
})

/** Exchange one JSON message; limit response size and bound unavailable workers. */
function command(action,timeoutMs=15000){return new Promise((resolve,reject)=>{
  const socket=createConnection(settings.dataRoot+'/run/control.sock')
  let data=''
  socket.setTimeout(timeoutMs,()=>socket.destroy(new Error('timeout')))
  socket.on('connect',()=>socket.write(JSON.stringify({action})+'\n'))
  socket.on('data',chunk=>{data+=chunk;if(data.length>200000)socket.destroy(new Error('oversized response'))})
  socket.on('error',reject)
  socket.on('end',()=>{try{resolve(JSON.parse(data))}catch{reject(new Error('invalid response'))}})
})}

/** Keep errors generic and prohibit cross-origin state changes even behind Basic Auth. */
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Referrer-Policy','same-origin')
  const respond=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))}
  const path=(req.url??'').split('?')[0]
  if(req.method==='GET'&&(path===prefix+'/'||path==='/')){
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'")
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(document);return
  }
  const action=path.startsWith(prefix+'/api/')?path.slice((prefix+'/api/').length):null
  if(action==='status'&&req.method==='GET'){
    if(resets.running){respond(200,{ok:true,result:null,reset:resets.status()});return}
    try{
      const payload=await command('status')
      if(!payload.ok){respond(503,{...payload,reset:resets.status()});return}
      // Browser visibility and vault lifecycle are independent: a closed window
      // must not make a completed vault disappear or imply a new test is needed.
      const [position,browser]=await Promise.all([withPositionStatus(payload),browserStatus(payload.result)])
      if(resets.running){respond(200,{ok:true,result:null,reset:resets.status()});return}
      respond(200,{...position,result:{...position.result,browser},reset:resets.status()})
    }catch{
      if(resets.running)respond(200,{ok:true,result:null,reset:resets.status()})
      else respond(503,{ok:false,error:'Test session is starting or unavailable.',reset:resets.status()})
    }return
  }
  if(!commandSet.has(action)){respond(404,{ok:false,error:'Not found'});return}
  if(req.method!=='POST'){respond(405,{ok:false,error:'POST required'});return}
  if(![settings.publicOrigin,'http://127.0.0.1:'+settings.webPort].filter(Boolean).includes(req.headers.origin)){respond(403,{ok:false,error:'Same-origin test controls required'});return}
  let size=0;const chunks=[]
  for await(const chunk of req){size+=chunk.length;if(size>4096){respond(413,{ok:false,error:'Request too large'});return}chunks.push(chunk)}
  if(action==='reset'){
    if(actionPending){respond(409,{ok:false,error:'Wait for the current test action to finish.'});return}
    let body
    try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{respond(400,{ok:false,error:'A current test identity is required.'});return}
    try{respond(202,{ok:true,reset:await resets.request(body?.sessionId)})}
    catch(error){respond(error.status??503,{ok:false,error:error.status?error.message:'Could not start a reset. Check status and retry.'})}
    return
  }
  if(resets.running||actionPending){respond(409,{ok:false,error:'The test is busy. Wait for the current action or reset to finish.'});return}
  actionPending=true
  try{
    if(action==='reopen'){
      const payload=await command('status')
      if(!payload.ok)throw Error('Session unavailable')
      respond(200,{ok:true,result:await reopenBrowser(payload.result)});return
    }
    respond(200,await command(action))
  }catch{respond(503,{ok:false,error:action==='reopen'?'Could not reopen the existing browser. No test was reset.':'Test session command unavailable.'})}
  finally{actionPending=false}
})
server.listen(settings.webPort,'127.0.0.1',()=>console.log('Local-only QA shell ready.'))
process.once('SIGTERM',()=>server.close())
