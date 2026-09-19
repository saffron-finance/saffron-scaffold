import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import {resolve} from 'node:path'
import app from '../vite.config'

/** Compile production components into a local-only preview. Reuse application
 * aliases/theme flags, but never emit its release marker or warm-page shells. */
export default defineConfig(async env=>{
 const production=await (app as Function)({...env,mode:'lab'})
 return {root:resolve('tests/deposit-spinner'),base:'/',plugins:[react(),svgr()],resolve:production.resolve,define:production.define,publicDir:resolve('public'),build:{outDir:resolve('validation/deposit-spinner-preview'),emptyOutDir:true}}
})
