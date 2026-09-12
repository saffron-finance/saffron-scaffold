import { test,expect } from '@playwright/test'
import { configurationJourney } from './configuration-journey.mjs'

for(const missingFeeRecipient of [true,false])test('admin configuration with '+(missingFeeRecipient?'missing':'valid')+' fee recipient',async({page})=>{
  await configurationJourney(page,{expect,missingFeeRecipient})
})
