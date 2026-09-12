import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySources } from './source-sync.mjs'

/** Compare current shared sources automatically in the combined repository.
 * A portable frontend archive can also verify its pins without a backend. */
const root=fileURLToPath(new URL('../',import.meta.url))
const canonical=resolve(root,'../../liquidity-incentives')
const backend=process.argv[2]??(existsSync(resolve(canonical,'package.json'))?canonical:undefined)
console.log(JSON.stringify(await verifySources(root,backend)))
