/** Fixed host adapter for the disposable QA reset. No caller-supplied unit,
 * shell text, path or command can reach systemctl or the encrypted archiver.
 */
import { execFile,spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir,readFile,readdir,writeFile,rename } from 'node:fs/promises'
import { createResetController } from './qa-reset.mjs'
import { browserStatus } from './qa-browser.mjs'

const execute=promisify(execFile)
import { settings } from './config.mjs'
const unit=settings.unitPrefix+'-browser.service'
const root=settings.dataRoot+'/resets'

/** Encrypt and verify the test database/chain/permit record before restarting. */
async function archive(record){return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/python3',[new URL('./archive-test.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']})
  let output='',failed=false
  const timeout=setTimeout(()=>{failed=true;child.kill('SIGTERM')},45000)
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16000){failed=true;child.kill('SIGTERM')}})
  // Never send a database/RPC/encryption diagnostic into a browser or transcript.
  child.stderr.resume()
  child.on('error',()=>{clearTimeout(timeout);reject(Error('Test archive unavailable'))})
  child.on('exit',code=>{clearTimeout(timeout);if(code!==0||failed){reject(Error('Test archive failed'));return}
    try{const result=JSON.parse(output);if(!result.databaseArchiveValidated||result.verifiedMembers<3)throw Error('Incomplete archive');resolve(result)}catch{reject(Error('Test archive verification failed'))}})
  child.stdin.end(JSON.stringify({id:record.id,before:record.before}))
})}

export async function createHostResetController(readStatus){
  await mkdir(root,{recursive:true,mode:0o700})
  return createResetController({readStatus,browserStatus,archive,
    readPid:async()=>{
      const {stdout}=await execute('/usr/bin/systemctl',['show',unit,'-p','MainPID','--value'],{timeout:5000})
      return Number(stdout.trim())
    },
    restart:async()=>{await execute('/usr/bin/systemctl',['restart',unit],{timeout:45000,maxBuffer:4000})},
    save:async record=>{
      const directory=root+'/'+record.id
      await mkdir(directory,{recursive:true,mode:0o700})
      const file=directory+'/reset.json'
      await writeFile(file+'.tmp',JSON.stringify(record,null,2)+'\n',{mode:0o600})
      await rename(file+'.tmp',file)
    },
    load:async()=>{
      const records=[]
      for(const directory of await readdir(root)){
        if(!/^[0-9a-f-]{36}$/.test(directory))continue
        try{records.push(JSON.parse(await readFile(root+'/'+directory+'/reset.json','utf8')))}catch(error){if(error.code!=='ENOENT')throw Error('Reset record unavailable')}
      }
      return records.sort((left,right)=>left.startedAt.localeCompare(right.startedAt))
    },
  })
}
