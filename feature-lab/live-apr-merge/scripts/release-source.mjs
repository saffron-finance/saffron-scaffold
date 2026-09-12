import { readFileSync,readdirSync,realpathSync,lstatSync,existsSync } from 'node:fs'
import { resolve,relative,extname,sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
export const sha256=data=>createHash('sha256').update(data).digest('hex')

/** Shared export/build inventory. Runtime settings and generated output are not
 * inputs; all adopted source and licenses remain part of the release identity. */
export function sourceFiles(root){
  root=realpathSync(root)
  const config=JSON.parse(readFileSync(resolve(root,'source-files.json'),'utf8')),files=[]
  function visit(path){
    const name=path.split(sep).at(-1)
    if(config.excludedNames.includes(name)||config.excludedSuffixes.includes(extname(name))||(name.startsWith('.env')&&name!=='.env.example'))return
    const info=lstatSync(path)
    if(info.isSymbolicLink()||!realpathSync(path).startsWith(root+sep))throw Error('Source inventory must stay inside its directory without links.')
    if(info.isDirectory())for(const item of readdirSync(path))visit(resolve(path,item))
    else if(info.isFile())files.push(relative(root,path).split(sep).join('/'))
  }
  for(const name of [...config.singles,...config.trees])visit(resolve(root,name))
  const names=[...new Set(files)].sort()
  if(names.some(name=>/[\\\x00-\x1f]/.test(name)))throw Error('Unsupported source path.')
  const hashes=Object.fromEntries(names.map(name=>{
    let data=readFileSync(resolve(root,name))
    if(config.textExtensions.includes(extname(name))||config.textNames.includes(name.split('/').at(-1)))data=Buffer.from(data.toString('utf8').replace(/\r\n/g,'\n'))
    return [name,sha256(data)]
  }))
  return {names,sourceDigest:sha256(names.map(name=>name+'\0'+hashes[name]+'\n').join(''))}
}
export function sourceIdentity(root){
  const {sourceDigest}=sourceFiles(root),pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'))
  const manifestPath=resolve(root,'source-manifest.json')
  if(existsSync(manifestPath)){
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
    if(manifest.release.version!==pkg.version||manifest.release.sourceDigest!==sourceDigest)throw Error('Exported source identity differs from its manifest.')
    return {...manifest.release,sourceDigest}
  }
  let revision=null,dirty=null
  try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain','--','.'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())}catch{}
  return {package:pkg.name,version:pkg.version,revision,sourceDigest,dirty}
}
