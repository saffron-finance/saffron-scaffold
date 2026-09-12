import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const key='saffron.live-apr-merge.campaign-preview.v1'

beforeEach(()=>{vi.resetModules();localStorage.clear()})
afterEach(()=>vi.restoreAllMocks())

/** Model a pre-upgrade browser with an edited campaign and an existing request.
 * The job sentinel is read through the catalog API, never priced or executed. */
async function saveLegacyBrowser(){
  const runtime=await import('./runtime')
  const catalog=await runtime.requestJson('/admin/catalog')
  const budget={...catalog.budgets[0],name:'My edited campaign',paused:true,revision:4}
  const program={...catalog.programs[0],minimumCents:'25000'}
  const customBudget={...budget,id:'custom-demo',name:'My custom campaign'}
  const customProgram={...program,id:'custom-demo',budgetPoolId:'custom-demo'}
  const saved={budgets:[budget,customBudget],programs:[program,customProgram],jobs:[{id:'saved-request',programId:'three-day-campaign',state:'retired'}]}
  localStorage.setItem(key,JSON.stringify(saved))
  localStorage.setItem('saffron.campaign-ui-preview.v1','original-preview-sentinel')
  vi.resetModules()
  return saved
}

it('keeps both APRs while excluding private planning budgets and request limits from the public catalog',async()=>{
  const {requestJson}=await import('./runtime')
  const {offers}=await requestJson('/programs')
  expect(offers).toHaveLength(2)
  const original=offers.find((offer:any)=>offer.id==='three-day-campaign')
  expect(original.eligibleMaximumCents).toBeUndefined()
  expect(original.minimumCents).toBeUndefined()
  expect(original.maximumCents).toBeUndefined()
  expect(original.budget.accounting).toBeUndefined()
  const added=offers.find((offer:any)=>offer.id==='five-day-campaign')
  expect(added.days).toBe(5)
  expect(added.apr.toFixed(2)).toBe('256.27')
  expect(added.budget.campaign.budgetCents).toBeUndefined()
  const catalog=await requestJson('/admin/catalog')
  expect(catalog.budgets.find((budget:any)=>budget.id==='five-day-campaign').campaign.budgetCents).toBe('3510548')
  expect(added.eligibleMaximumCents).toBeUndefined()
  expect(added.availability).toBeNull()
  expect(added.budget.paused).toBe(false)
})

it('upgrades existing storage once without losing requests, custom campaigns, or later pause changes',async()=>{
  const saved=await saveLegacyBrowser()
  const runtime=await import('./runtime')
  const upgraded=JSON.parse(localStorage.getItem(key)!)
  expect(upgraded.budgets.slice(0,2)).toEqual(saved.budgets)
  expect(upgraded.programs.slice(0,2)).toEqual(saved.programs)
  expect(upgraded.jobs).toEqual(saved.jobs)
  expect(upgraded.budgets).toHaveLength(3)
  expect(upgraded.programs).toHaveLength(3)
  // Admin edits to the new sample must survive subsequent imports/reloads.
  await runtime.requestJson('/admin/budgets',{id:'five-day-campaign',paused:true,revision:1})
  const paused=localStorage.getItem(key)
  vi.resetModules()
  const reloaded=await import('./runtime')
  const {offers}=await reloaded.requestJson('/programs')
  expect(offers).toHaveLength(3)
  expect(offers.find((offer:any)=>offer.id==='five-day-campaign').availability).toBe('Campaign paused')
  expect(localStorage.getItem(key)).toBe(paused)
  expect(localStorage.getItem('saffron.campaign-ui-preview.v1')).toBe('original-preview-sentinel')
})

it('keeps saved work in memory when writing the additive upgrade is denied',async()=>{
  const saved=await saveLegacyBrowser()
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError')})
  const {requestJson}=await import('./runtime')
  const catalog=await requestJson('/admin/catalog')
  expect(catalog.budgets).toHaveLength(3)
  expect(catalog.budgets[0].name).toBe('My edited campaign')
  expect(catalog.budgets[0].paused).toBe(true)
  expect((await requestJson('/deployments')).deployments).toEqual(saved.jobs)
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved)
})
