import { mkdtemp,rm,chmod,lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensurePrivateDirectory } from '../worker/protected-files.mjs'

/** Only disposable files created by a test are permissioned or removed. Native
 * ACL fixtures exercise the production checks, without test-only bypasses. */
export async function privateFilesFixture(prefix='saffron-private-test-'){
  if(!/^saffron-[a-z-]+-$/.test(prefix))throw new Error('Invalid fixture prefix.')
  const root=await mkdtemp(join(tmpdir(),prefix)),directory=join(root,'private')
  const close=async()=>{
    if(!resolve(root).startsWith(resolve(tmpdir())+sep+prefix))throw new Error('Unsafe fixture cleanup path.')
    await rm(root,{recursive:true,force:true})
  }
  try{await ensurePrivateDirectory(directory);return {directory,close}}
  catch(error){await close();throw error}
}

export async function setFixtureAccess(file,access){
  if(!['private','readable','writable'].includes(access))throw new Error('Invalid fixture access.')
  if(process.platform!=='win32'){
    const directory=(await lstat(file)).isDirectory()
    await chmod(file,(access==='private'?0o600:access==='readable'?0o644:0o666)|(directory?0o100:0))
    return
  }
  const executable=join(process.env.SystemRoot,'System32','icacls.exe')
  const args=access==='private'?['/remove:g','*S-1-1-0']:['/grant:r','*S-1-1-0:'+(access==='readable'?'R':'M')]
  try{await promisify(execFile)(executable,[file,...args],{windowsHide:true,timeout:15000})}
  catch{throw new Error('Could not set disposable fixture ACL.')}
}
