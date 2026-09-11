import { it } from 'node:test'
import assert from 'node:assert/strict'
import { open,readFile,lstat,symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { assertProtectedPath,ensurePrivateDirectory,protectedWindowsAcl,replaceProtectedState } from '../worker/protected-files.mjs'
import { privateFilesFixture,setFixtureAccess } from './private-files-fixture.mjs'

it('Windows ACL policy permits trusted operators but rejects broad access, unsafe ownership and absent evidence',()=>{
  const user='S-1-5-21-100-200-300-1001',other='S-1-1-0'
  const allow=(sid,rights)=>({sid,type:'Allow',rights})
  const acl={user,owner:user,hasDacl:true,reparse:false,rules:[allow(user,0x1f01ff),allow('S-1-5-18',0x1f01ff),allow('S-1-5-32-544',0x1f01ff)]}
  assert.equal(protectedWindowsAcl(acl),true)
  for(const change of [{hasDacl:false},{reparse:true},{owner:other},{user:null},{rules:null},{rules:[{}]}])assert.equal(protectedWindowsAcl({...acl,...change}),false)
  const readable={...acl,rules:[...acl.rules,allow(other,0x120089)]}
  assert.equal(protectedWindowsAcl(readable),false,'credentials cannot be read by Everyone')
  assert.equal(protectedWindowsAcl(readable,{privateAccess:false}),true,'read-only public configuration is safe')
  // Include generic rights and inherited/inherit-only grants: a private
  // directory must not grant dangerous access to newly created children.
  for(const rights of [2,4,16,64,256,65536,262144,524288,0x40000000,0x10000000]){
    const writable={...acl,rules:[...acl.rules,{...allow(other,rights),inherited:true,inheritOnly:true}]}
    assert.equal(protectedWindowsAcl(writable,{privateAccess:false}),false)
  }
  assert.equal(protectedWindowsAcl({...readable,rules:[...readable.rules,{sid:other,type:'Deny',rights:0x1f01ff}]}),false,'a deny rule does not excuse a broad allow')
})

it('existing unsafe state directories and junctions are rejected without changing their permissions',async()=>{
  const files=await privateFilesFixture('saffron-path-test-'),directory=join(files.directory,'state')
  try{
    await ensurePrivateDirectory(directory)
    await ensurePrivateDirectory(directory)
    await setFixtureAccess(directory,'writable')
    await assert.rejects(ensurePrivateDirectory(directory),/owner-only/)
    await assert.rejects(assertProtectedPath(directory,{directory:true}),/permissions/)
    await setFixtureAccess(directory,'private')
    const link=join(files.directory,'link')
    await symlink(directory,link,process.platform==='win32'?'junction':'dir')
    await assert.rejects(ensurePrivateDirectory(link),/owner-only/)
  }finally{await files.close()}
})

it('protected state survives initial publication and replacement, retaining private access',async()=>{
  const files=await privateFilesFixture('saffron-state-test-'),destination=join(files.directory,"state [literal] O'Brien $; café.json")
  try{
    for(const status of ['armed','completed']){
      const source=join(files.directory,'next.tmp'),handle=await open(source,'wx',0o600)
      try{await handle.writeFile(JSON.stringify({status}));await handle.sync()}finally{await handle.close()}
      await assert.rejects(replaceProtectedState(source,join(files.directory,'elsewhere','state.json')),/private directory/)
      await replaceProtectedState(source,destination)
      await assertProtectedPath(destination)
      assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),{status})
      await assert.rejects(lstat(source),{code:'ENOENT'})
    }
    await setFixtureAccess(destination,'readable')
    await assert.rejects(assertProtectedPath(destination),/permissions/)
  }finally{await files.close()}
})
