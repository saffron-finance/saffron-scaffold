import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve(process.env.PROGRAM_APP||'.')
const ts=createRequire(resolve(root,'package.json'))('typescript')

/** AST-based display-copy audit, written before implementation. Identifiers,
 * API paths, historical fixture IDs and storage keys are not user-facing copy.
 * Only two bare compatibility selectors remain permitted in the route owner. */
test('all active frontend display literals use incentive-program terminology',async()=>{
 const errors=[]
 async function walk(dir){for(const row of await readdir(dir,{withFileTypes:true})){
  const path=resolve(dir,row.name)
  if(row.isDirectory()){await walk(path);continue}
  if(!/\.[jt]sx?$/.test(path)||/\.test\./.test(path))continue
  const content=await readFile(path,'utf8'),source=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,path.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
  function visit(node){
   if(ts.isJsxText(node)||ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
    const text=node.text.trim()
    if(/\bcampaigns?\b/i.test(text)&&!/^\.?\.?\/|^https?:\/\/|^saffron\.|^campaign-|^data-campaign-/.test(text)&&!(text==='campaigns'&&/merge\/main\.tsx$/.test(path))){
     const line=source.getLineAndCharacterOfPosition(node.getStart()).line+1
     errors.push({file:path.slice(root.length+1),line,text:text.slice(0,140)})
    }
   }
   ts.forEachChild(node,visit)
  }visit(source)
 }}
 await walk(resolve(root,'src'))
 assert.deepEqual(errors,[])
})

/** Both the current guide and its authoring input must retain the new wording. */
test('installation guide and its source use incentive-program terminology',async()=>{
 for(const name of ['docs/install-guide.json','public/install.html']){
  const text=await readFile(resolve(root,name),'utf8')
  assert.doesNotMatch(text,/\bcampaigns?\b/i,name)
 }
})
