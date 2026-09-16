import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request} from 'node:http'
import {once} from 'node:events'
import {spawn} from 'node:child_process'

/** Exercise the actual listener with a loopback-only RPC fixture. No wallet,
 * credential, external upstream or production service participates. */
test('L02 malformed paths stay bounded and the server continues serving read-only requests',async()=>{
  const rpc=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const call=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result:'0x1'}))})
  rpc.listen(0,'127.0.0.1');await once(rpc,'listening')
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r))
  const child=spawn(process.execPath,['server/proxy.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),BASE_PATH:'/fixture',RPC_ETHEREUM:`http://127.0.0.1:${rpc.address().port}`},stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c)
  const call=(path,method='GET',body)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path,method,headers:body?{'content-type':'application/json'}:{}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,data}))});req.on('error',reject);req.end(body)})
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('fixture start timeout')),5000);child.stdout.on('data',()=>{if(output.includes('Saffron dashboard')){clearTimeout(timeout);resolve()}});child.on('exit',()=>{clearTimeout(timeout);reject(Error('fixture exited'))})})
    for(const path of ['/fixture/%zz','/fixture/%E0%A4%A','/fixture/%00'])assert.equal((await call(path)).status,400)
    assert.equal((await call('/fixture/%2e%2e%2fpackage.json')).status,403)
    assert.equal((await call('/fixture/')).status,200)
    assert.equal((await call('/fixture/nested/route')).status,200)
    assert.equal((await call('/fixture/rpc/ethereum','POST',JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}))).status,200)
    for(const body of ['{bad',JSON.stringify({method:'eth_sendTransaction'}),JSON.stringify([{method:'eth_chainId'},{method:'eth_sendRawTransaction'}])])assert.equal((await call('/fixture/rpc/ethereum','POST',body)).status,403)
    assert.equal((await call('/fixture/rpc/ethereum')).status,405)
    assert.equal((await call('/fixture/rpc/nope','POST','{}')).status,404)
    assert.equal((await call('/fixture/rpc/ethereum','POST','x'.repeat(2100000))).status,413)
    assert.equal(child.exitCode,null);assert.equal((await call('/fixture/')).status,200)
    assert.ok(!/URIError|Unhandled|private-provider/.test(output))
  }finally{child.kill();await once(child,'exit');await new Promise(r=>rpc.close(r))}
})
