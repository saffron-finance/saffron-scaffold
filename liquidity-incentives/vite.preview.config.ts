import { defineConfig,mergeConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname,resolve } from 'node:path'
import application from './vite.config'

const here=(path:string)=>fileURLToPath(new URL(path,import.meta.url))
/** Compile-time substitution only: the live entry/build never imports sample data.
 * Preview transport has no network fallback and the wallet hooks are excluded. */
export default defineConfig(async env=>{
  const base=await (application as any)(env)
  const replaced=new Set(['transport','useOfferPrice','useDeploymentFlow','useVaultPosition'].map(name=>here('./src/host/'+name)))
  return mergeConfig(base,{plugins:[{name:'isolate-ui-preview',enforce:'pre',resolveId(source:string,importer?:string){
    if(importer&&source.startsWith('.')&&replaced.has(resolve(dirname(importer),source).replace(/\.tsx?$/,'')))return here('./src/preview/runtime.ts')
  }}],build:{outDir:'dist-preview',rollupOptions:{input:here('./preview.html')}}})
})
