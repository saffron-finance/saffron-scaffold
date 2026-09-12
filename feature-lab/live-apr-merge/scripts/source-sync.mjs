import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'

export const sourceHash=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex')
export async function verifySources(root,backend){
  const manifest=JSON.parse(await readFile(resolve(root,'docs/upstream-sync.json'),'utf8')),failures=[]
  for(const [file,expected] of Object.entries(manifest.exactFiles)){
    for(const [label,directory] of [['Local import',root],...(backend?[['Backend',backend]]:[])]){
      try{if(sourceHash(await readFile(resolve(directory,file),'utf8'))!==expected)failures.push(label+' drift: '+file)}
      catch{failures.push(label+' missing or unreadable: '+file)}
    }
  }
  if(failures.length)throw new Error(failures.join('\n'))
  return {ok:true,backendBaseline:manifest.backendCommit,exactFiles:Object.keys(manifest.exactFiles).length,comparedBackend:Boolean(backend),normalization:'CRLF to LF only'}
}
