import { JSDOM } from 'jsdom'
import { beforeEach,afterAll } from 'vitest'

// Browser storage must use the same Storage prototype as the denial/recovery
// tests. Native Node storage has separate semantics and process persistence.
const browser=new JSDOM('',{url:'https://incentives.test/'})
for(const target of new Set([globalThis,window]))for(const name of ['Storage','localStorage','sessionStorage'])
  Object.defineProperty(target,name,{configurable:true,value:browser.window[name]})
beforeEach(()=>{localStorage.clear();sessionStorage.clear()})
afterAll(()=>browser.window.close())
