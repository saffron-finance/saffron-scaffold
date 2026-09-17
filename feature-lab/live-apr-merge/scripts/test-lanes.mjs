import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** One predictable, quiet entry point. Logs remain available on failures; npm
 * checks are deterministic local processes and make no model/API token calls.
 * This runner does not install dependencies, build assets or restart services.
 */
const root=fileURLToPath(new URL('../',import.meta.url))
const lanes={
  fast:['test','typecheck','check:upstream','check:test-catalog','test:source','test:release'],
  native:['test:emblem-native'],
  public:['test:checkout-dismissal','test:checkout-navigation','test:apr-http'],
  host:['test:wallet-preflight','test:intake-policy','test:high-recovery'],
  downloads:['test:downloads'],
}
const lane=process.argv[2]??'fast'
if(!Object.hasOwn(lanes,lane))throw Error('Choose a test lane: '+Object.keys(lanes).join(', '))
if(['public','host'].includes(lane)&&!process.env.SAFFRON_BACKEND_SOURCE)throw Error('This browser lane requires an explicit disposable backend fixture checkout (SAFFRON_BACKEND_SOURCE).')
if(lane==='host'&&process.env.SAFFRON_TEST_BACKEND_KIND!=='host')throw Error('Host API tests require SAFFRON_TEST_BACKEND_KIND=host and the private application-source fixture. The historical public API is not equivalent.')
const output=resolve(root,'validation/test-lanes',`${new Date().toISOString().replace(/[:.]/g,'-')}-${lane}`)
await mkdir(output,{recursive:true})
const results=[]
for(const script of lanes[lane]){
  const logfile=resolve(output,script.replaceAll(':','-')+'.log'),sink=createWriteStream(logfile)
  const args=['run',script,...(script==='test'?['--','--maxWorkers=4']:[])]
  const started=performance.now()
  // npm.cmd on Windows is explicitly launched by cmd.exe; no user-supplied
  // command text is interpolated. Script names above form the full allowlist.
  const command=process.platform==='win32'?process.env.ComSpec??'cmd.exe':'npm'
  let timedOut=false, logBytes=0, escalation
  const child=spawn(command,process.platform==='win32'?['/d','/s','/c','npm.cmd',...args]:args,{cwd:root,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
  const stop=()=>{
    if(child.exitCode!==null)return
    if(process.platform==='win32')child.kill()
    else {
      try{process.kill(-child.pid,'SIGTERM')}catch{/* Already exited. */}
      // A broken test may ignore graceful shutdown. Only this owned process
      // group is eligible for escalation; unrelated services are never targeted.
      escalation??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{/* Already exited. */}},5000)
    }
  }
  const deadline=setTimeout(()=>{timedOut=true;stop()},lane==='fast'?300_000:600_000)
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
    logBytes+=chunk.length
    if(logBytes<=20*1024*1024)sink.write(chunk)
    else stop() // An accidental log loop must not fill the filesystem.
  })
  const outcome=await new Promise(resolve=>{child.once('error',error=>resolve({code:1,error:error.message}));child.once('exit',(code,signal)=>resolve({code:code??1,signal}))})
  clearTimeout(deadline);clearTimeout(escalation)
  if(timedOut||logBytes>20*1024*1024)outcome.code=1
  await new Promise(resolve=>sink.end(resolve))
  const result={script,...outcome,timedOut,logBytes,seconds:Math.round((performance.now()-started)/10)/100,log:logfile}
  results.push(result);await writeFile(resolve(output,'results.json'),JSON.stringify({lane,results},null,2)+'\n')
  console.log(`${outcome.code?'FAIL':'PASS'} ${script} ${result.seconds}s`)
  if(outcome.code){
    const log=await readFile(logfile,'utf8');console.error(log.split('\n').slice(-45).join('\n'))
    process.exitCode=1;break
  }
}
console.log('Evidence: '+output)
