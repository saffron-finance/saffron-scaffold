// Test-process preload only. A local-chain time jump needs the API and browser
// clocks to move together; this module is never imported by application code.
import { readFileSync } from 'node:fs'
const actual=Date.now
if(process.env.NODE_ENV!=='test'||!process.env.SAFFRON_TEST_CLOCK_FILE)throw new Error('Test clock is only available in the disposable harness.')
Date.now=()=>actual()+Number(readFileSync(process.env.SAFFRON_TEST_CLOCK_FILE,'utf8'))
