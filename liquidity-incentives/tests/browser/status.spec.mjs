import { test,expect } from '@playwright/test'
import { statusJourney } from './status-journey.mjs'
test('operator status explains startup, isolates outages, and preserves wallet gates',async({page})=>{
  await statusJourney(page,{expect})
})
