import { execFile } from 'node:child_process'
import { lstat,mkdir,open,readFile,rename } from 'node:fs/promises'
import { dirname,join,resolve } from 'node:path'

let windowsScript
async function windowsOperation(request){
  windowsScript??=await readFile(new URL('./windows-files.ps1',import.meta.url),'utf8')
  if(!process.env.SystemRoot)throw new Error('Windows security services are unavailable.')
  const executable=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')
  // Use the matching system modules even when launched from PowerShell Core.
  const env={...process.env,PSModulePath:join(dirname(executable),'Modules')}
  return new Promise((accept,reject)=>{
    // Only fixed repository code enters the command. Paths are literal JSON on
    // stdin; credentials and file contents never enter the helper or its output.
    const child=execFile(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsScript,'utf16le').toString('base64')],
      {env,windowsHide:true,timeout:15000,maxBuffer:65536},(error,stdout)=>{
        if(error){reject(new Error('Windows protected-file operation failed.'));return}
        try{accept(JSON.parse(stdout.replace(/^\uFEFF/,'')))}catch{reject(new Error('Windows security evidence is unavailable.'))}
      })
    child.stdin.on('error',()=>{})
    child.stdin.end(JSON.stringify(request))
  })
}

/** Windows has ACLs rather than Unix owner/group mode bits. Privileged OS
 * administrators and SYSTEM remain trusted, like root on Unix. Broad grants
 * are rejected conservatively even if another ACE might deny them. */
export function protectedWindowsAcl(acl,{privateAccess=true}={}){
  if(!acl?.hasDacl||acl.reparse||!/^S-1-/.test(acl.user??'')||!Array.isArray(acl.rules))return false
  const trusted=new Set([acl.user,'S-1-5-18','S-1-5-32-544'])
  if(!trusted.has(acl.owner))return false
  // Write/append data, attributes, deletion, ACL/owner changes and generic writes.
  const writes=0x500d0156
  return acl.rules.every(rule=>{
    if(!['Allow','Deny'].includes(rule.type)||!Number.isInteger(rule.rights)||!/^S-1-/.test(rule.sid??''))return false
    return rule.type==='Deny'||trusted.has(rule.sid)||(privateAccess?rule.rights===0:((rule.rights>>>0)&writes)===0)
  })
}

export async function assertProtectedPath(path,{directory=false,privateAccess=true,maxBytes=Infinity,message='Protected path permissions are invalid.'}={}){
  const info=await lstat(path)
  if(!(directory?info.isDirectory():info.isFile())||info.isSymbolicLink()||info.size>maxBytes)throw new Error(message)
  if(process.platform==='win32'){
    let acl
    try{acl=await windowsOperation({action:'inspect',path:resolve(path)})}catch{throw new Error(message)}
    if(!protectedWindowsAcl(acl,{privateAccess}))throw new Error(message)
  }else if(info.mode&(privateAccess?0o077:0o022))throw new Error(message)
  return info
}

/** Provision only a missing directory. Existing insecure directories are rejected,
 * never silently repermissioned. Children inherit the private Windows DACL. */
export async function ensurePrivateDirectory(path){
  try{await lstat(path)}catch(error){
    if(error.code!=='ENOENT')throw error
    if(process.platform==='win32')await windowsOperation({action:'create-directory',path:resolve(path)})
    else await mkdir(path,{recursive:true,mode:0o700})
  }
  await assertProtectedPath(path,{directory:true,message:'One-shot state must be an owner-only directory.'})
}

/** The file contents must already be fsynced. Windows cannot fsync a directory
 * through Node; use its same-volume, write-through replacement primitive. */
export async function replaceProtectedState(source,destination){
  if(dirname(resolve(source))!==dirname(resolve(destination)))throw new Error('State replacement must stay in its private directory.')
  if(process.platform==='win32'){
    await assertProtectedPath(source)
    await windowsOperation({action:'replace',path:resolve(source),destination:resolve(destination)})
  }else{
    await rename(source,destination)
    const parent=await open(dirname(destination),'r');try{await parent.sync()}finally{await parent.close()}
  }
}
