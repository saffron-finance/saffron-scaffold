import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { mnemonicToAccount,privateKeyToAccount } from 'viem/accounts'
import { assertProtectedPath } from './protected-files.mjs'

/** Read a host-owned protected value without shell interpolation or logging.
 * A pass reference is decrypted only inside this process; callers must never
 * serialize the returned buffer, key, provider URL or underlying exceptions. */
export async function protectedValue({file,passEntry}){
  if(Boolean(file)===Boolean(passEntry))throw new Error('Choose one protected credential reference.')
  if(passEntry){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(passEntry)||passEntry.includes('..'))throw new Error('Invalid protected entry reference.')
    try{return execFileSync('pass',['show',passEntry],{stdio:['ignore','pipe','ignore'],maxBuffer:65536})}
    catch{throw new Error('Protected entry unavailable.')}
  }
  await assertProtectedPath(file,{maxBytes:65536,message:'Credential must be an owner-only regular file.'})
  return readFile(file)
}

/** Resolve the authorized signer, verify its public identity, and zero the input
 * buffer. Signing keys stay in the worker account object, never the HTTP API. */
export async function loadSigner({signerAddress,signerCredentialFile,signerPassEntry,signerKind='privateKey'}){
  const data=await protectedValue({file:signerCredentialFile,passEntry:signerPassEntry})
  try{
    if(!['privateKey','mnemonic'].includes(signerKind))throw new Error('Unsupported signer format.')
    const account=signerKind==='mnemonic'?mnemonicToAccount(data.toString().trim()):privateKeyToAccount(data.toString().trim())
    if(account.address.toLowerCase()!==signerAddress?.toLowerCase())throw new Error('Protected signer address mismatch.')
    return account
  }finally{data.fill(0)}
}

export const READ_METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode',
  'eth_getStorageAt','eth_getProof','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_call','eth_estimateGas','eth_gasPrice','eth_feeHistory','eth_maxPriorityFeePerGas','net_version'])

/** Credential-isolated RPC transport. Fork upstreams are strictly read-only.
 * Broadcasting is allowed only by an explicitly configured worker transport;
 * errors expose a method name, never an endpoint, request body or signed bytes. */
export async function protectedRpc({rpcUrl,rpcPassEntry,rpcEntryName,readOnly=true}){
  let endpoint=rpcUrl
  if(rpcPassEntry){
    if(rpcUrl||!/^[A-Z][A-Z0-9_]*$/.test(rpcEntryName??''))throw new Error('Invalid RPC reference.')
    const data=await protectedValue({passEntry:rpcPassEntry})
    try{
      const line=data.toString().split(/\r?\n/).find(value=>value.startsWith(rpcEntryName+'='))
      endpoint=line?.slice(rpcEntryName.length+1).trim().replace(/^(['"])(.*)\1$/,'$2')
    }finally{data.fill(0)}
  }
  let url;try{url=new URL(endpoint)}catch{throw new Error('RPC configuration unavailable.')}
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('RPC must use HTTPS or loopback.')
  // Fork gas estimation fans out many account reads. Bound provider concurrency
  // and retry only idempotent reads; a send's ambiguous outcome goes to the
  // creator journal/reconciliation path instead of hidden transport retries.
  let active=0;const waiting=[]
  return async(method,params=[])=>{
    if(!READ_METHODS.has(method)&&(readOnly||method!=='eth_sendRawTransaction'))throw new Error('RPC method is not permitted.')
    if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++
    try{
      for(let attempt=0;attempt<4;attempt++){
        let transient=false
        try{
          const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000),redirect:'error'})
          const body=await response.json()
          transient=response.status===429||response.status>=500||[-32005,-32016].includes(body.error?.code)||/rate|limit|capacity|too many/i.test(body.error?.message??'')
          if(!response.ok||body.error||body.id!==1||!Object.hasOwn(body,'result'))throw new Error()
          return body.result
        }catch(error){
          transient=transient||error.name==='TimeoutError'||error.name==='TypeError'
          if(!READ_METHODS.has(method)||!transient||attempt===3)throw new Error('RPC operation unavailable: '+method)
          await delay(250*2**attempt)
        }
      }
    }finally{const next=waiting.shift();if(next)next();else active--}
  }
}
