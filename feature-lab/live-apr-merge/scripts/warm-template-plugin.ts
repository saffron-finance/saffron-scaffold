import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/** Compile the real presentation components for build-time rendering. Browser
 * bundles never receive React's server renderer. Asset placeholders are mapped
 * to Vite's existing fingerprinted outputs, avoiding duplicate downloads. */
export function warmTemplatePlugin(root:string,base:string,tweaks:boolean,settings:Record<string,string>):Plugin {
  return {name:'warm-home-template',apply:'build',enforce:'post',async generateBundle(_options,bundle) {
    const assets=new Map<string,string>()
    const compiled=await build({entryPoints:[resolve(root,'scripts/warm-template.tsx')],bundle:true,write:false,
      platform:'node',format:'cjs',jsx:'automatic',packages:'external',
      alias:{'@fixed':resolve(root,'vendor/fixed-income-ui'),'@lab':resolve(root,'src/adapters')},
      define:{'import.meta.env.BASE_URL':JSON.stringify(base),'import.meta.env.VITE_DEV_TWEAKS':JSON.stringify(tweaks?'true':'false'),
        'import.meta.env.VITE_FEATURE_LAB_HREF':JSON.stringify(settings.VITE_FEATURE_LAB_HREF||''),'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
      plugins:[{name:'template-assets',setup(builder){
        builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}))
        // Closed modal icons are irrelevant to the startup shell; avoid needing
        // the browser's SVG-to-React plugin in this server-only compilation.
        builder.onResolve({filter:/\.svg\?react$/},args=>({path:args.path,namespace:'closed-icon'}))
        builder.onLoad({filter:/.*/,namespace:'closed-icon'},()=>({contents:'export default function Icon(){return null}',loader:'js'}))
        builder.onLoad({filter:/\.(svg|png|jpg|jpeg|woff2)$/},async args=>{
          const bytes=await readFile(args.path),digest=createHash('sha256').update(bytes).digest('hex')
          const marker='__WARM_ASSET_'+digest+'__';assets.set(marker,digest)
          return {contents:'export default '+JSON.stringify(marker),loader:'js'}
        })
        if(!tweaks){builder.onResolve({filter:/\/dev\/RowTweaks$/},()=>({path:'disabled',namespace:'no-tweaks'}));builder.onLoad({filter:/.*/,namespace:'no-tweaks'},()=>({contents:'export default function NoTweaks(){return null}',loader:'js'}))}
      }}],logLevel:'silent'})
    const module={exports:{} as {warmTemplates:()=>{shell:string;group:string;variants:Record<string,string>;css:string}}}
    const require=createRequire(resolve(root,'package.json'))
    // styled-components v5 publishes a CJS namespace with its callable default
    // nested inside. Match Vite's browser interop in the temporary SSR bundle.
    const requireTemplate=(id:string)=>{
      const value=require(id)
      return id==='styled-components'?Object.assign(value.default,value):value
    }
    new Function('require','module','exports',compiled.outputFiles[0].text)(requireTemplate,module,module.exports)
    const templates=module.exports.warmTemplates()
    let html=templates.css+`<template id="warm-shell">${templates.shell}</template><template id="warm-group">${templates.group}</template>`
      +Object.entries(templates.variants).map(([name,body])=>`<template id="warm-row-${name}">${body}</template>`).join('')
    for(const [marker,digest]of assets){
      if(!html.includes(marker))continue
      const asset=Object.values(bundle).find(item=>item.type==='asset'&&createHash('sha256').update(item.source).digest('hex')===digest)
      if(!asset)throw Error('Warm template asset missing from application build: '+digest)
      html=html.replaceAll(marker,base+asset.fileName)
    }
    const entry=bundle['index.html']
    if(!entry||entry.type!=='asset')throw Error('Missing application HTML')
    // Download/compile the main module alongside the small display bootstrap,
    // without executing it. Cached pixels must not serialize module discovery
    // or make wallet/navigation initialization wait for another cache lookup.
    const application=Object.values(bundle).find(item=>item.type==='chunk'&&item.name==='main')
    if(!application)throw Error('Missing application module')
    entry.source=String(entry.source).replace('</head>',`<link rel="modulepreload" crossorigin href="${base+application.fileName}"></head>`)
    // Templates are inert until a valid Home snapshot exists. Expired/cleared
    // caches and every other route keep the current cold startup unchanged.
    entry.source=String(entry.source).replace('</body>',html+'</body>')
  }}
}
