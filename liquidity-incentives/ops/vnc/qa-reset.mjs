/** Serialized, session-pinned reset coordinator. Production service names and
 * arbitrary commands never enter this module through a browser request. All
 * effects are injected so failure and replay boundaries can be tested in isolation.
 */
import { randomUUID } from 'node:crypto'
import { fixtureOrigin } from './qa-status.mjs'

export const sessionId=data=>data.user.toLowerCase()
const pending=new Set(['checking','saving','restarting','starting'])
const messages={saving:'Saving the current test record…',restarting:'Restarting the disposable test…',
  starting:'Preparing the fresh wallet and browser…',ready:'Fresh test ready. Connect the test wallet to begin.'}
const fault=(status,message)=>Object.assign(Error(message),{status})

/** Public metadata deliberately omits backups, raw state, debug ports and PIDs. */
function publicReset(record){return record?{id:record.id,state:record.state,running:pending.has(record.state),
  message:record.message,previousSessionId:record.previousSessionId,newSessionId:record.newSessionId??null,
  startedAt:record.startedAt,finishedAt:record.finishedAt??null}:null}

/** A fresh fixture must have a new identity/process and no user lifecycle state. */
export function isFresh(data,before,pid,oldPid){
  fixtureOrigin(data)
  return pid>0&&pid!==oldPid&&sessionId(data)!==sessionId(before)&&data.commit===before.commit&&
    data.creator.toLowerCase()!==before.creator.toLowerCase()&&data.treasury.toLowerCase()!==before.treasury.toLowerCase()&&
    !data.busy&&!data.clockAdvanced&&data.jobs.length===0&&data.operations.length===0&&
    data.userTransactions===0&&data.userMessageSignatures===0&&data.creatorBroadcasts===0
}

export async function createResetController({readStatus,readPid,archive,restart,browserStatus,save,load,
  delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),timeoutMs=120000}){
  const history=new Map()
  let latest=null,active=null,accepting=null,work=Promise.resolve()
  for(const record of await load()){
    // A web-shell restart must never blindly replay a destructive command.
    // Keep the prior archive/intent visible and require a fresh explicit retry.
    if(pending.has(record.state)){
      record.state='failed';record.message='Reset was interrupted. Check the current session before retrying.'
      record.finishedAt=new Date(now()).toISOString();await save(record)
    }
    history.set(record.previousSessionId,record);latest=record
  }

  /** Persist each phase before its effect. Backup failure cannot reach restart. */
  async function execute(record){
    const phase=async state=>{record.state=state;record.message=messages[state];await save(record)}
    try{
      record.archive=await archive(record)
      record.restartRequested=true
      await phase('restarting')
      await restart()
      await phase('starting')
      const deadline=now()+timeoutMs
      while(now()<deadline){
        try{
          const data=await readStatus(),pid=await readPid()
          if(isFresh(data,record.before,pid,record.oldPid)&&(await browserStatus(data)).open){
            record.newSessionId=sessionId(data);record.newPid=pid;record.after=data
            record.finishedAt=new Date(now()).toISOString()
            await phase('ready');return
          }
        }catch{/* The old socket disappears during the scoped fixture restart. */}
        await delay(1000)
      }
      throw Error('Fresh test readiness deadline exceeded')
    }catch{
      record.state='failed';record.finishedAt=new Date(now()).toISOString()
      record.message=record.restartRequested?'Fresh test did not become ready. The previous test record was saved.':
        'Could not save the test record. Your current test was not reset.'
      await save(record)
    }finally{active=null}
  }

  /** The old wallet identity is the idempotency key. Late/double clicks from that
   * test return its recorded reset, never reset the newly created test a second time.
   */
  async function request(expected){
    if(!/^0x[0-9a-f]{40}$/.test(expected??''))throw fault(400,'Refresh status before starting a fresh test.')
    const prior=history.get(expected)
    if(prior&&prior.state!=='failed')return publicReset(prior)
    if(accepting){if(accepting.expected===expected)return accepting.promise;throw fault(409,'Another reset is in progress.')}
    if(active)throw fault(409,'Another reset is in progress.')
    let resolve,reject
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
    accepting={expected,promise,startedAt:new Date(now()).toISOString()}
    // Start admission in a separate microtask so duplicate callers can join the
    // acceptance promise even while the current fixture is being checked.
    void (async()=>{
      try{
        const before=await readStatus();fixtureOrigin(before)
        if(sessionId(before)!==expected)throw fault(409,'This is an older test. Refresh status before starting another one.')
        if(before.busy)throw fault(409,'Vault creation is in progress. Wait for it to finish before resetting.')
        const oldPid=await readPid()
        if(oldPid<=0)throw fault(503,'The test fixture is unavailable. No reset was started.')
        const record={id:randomUUID(),previousSessionId:expected,before,oldPid,state:'saving',message:messages.saving,
          startedAt:new Date(now()).toISOString(),restartRequested:false}
        await save(record)
        history.set(expected,record);latest=record;active=record
        work=execute(record)
        // Report errors generically; a persistence failure must not become an
        // unhandled rejection or cause an implicit second restart.
        void work.catch(()=>{})
        resolve(publicReset(record))
      }catch(error){reject(error)}finally{accepting=null}
    })()
    return promise
  }
  return {request,get running(){return Boolean(active||accepting)},status:()=>publicReset(active??(accepting?
    {id:null,state:'checking',message:'Checking the current test…',previousSessionId:accepting.expected,startedAt:accepting.startedAt}:latest)),
    settle:()=>work}
}
