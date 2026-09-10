import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { digest, snapshotFor } from '../shared/incentives.mjs'

export const TOKEN='0x020bfc650a365f8bb26819deaabf3e21291018b4'
export const QUOTE_TOKEN='0x0bd7d308f8e1639fab988df18a8011f41eacad73'
export const POOL='0xa70fc67c9f69da90b63a0e4c05d229954574e313'
export const ORIGIN='http://127.0.0.1:13218'
export const pair={id:'cashcat-eth',revision:0,chainId:4663,pool:POOL,feeTier:10000,
  token0:{address:TOKEN,symbol:'CASHCAT',decimals:18},token1:{address:QUOTE_TOKEN,symbol:'ETH',decimals:18},active:true}
export const program={id:'cashcat-3d',revision:0,pairId:pair.id,budgetPoolId:'cashcat-campaign',apr:1000,days:3,
  minimumCents:'100',maximumCents:'10000000',sortOrder:0,isNew:true,active:true}

export async function incentivesFixture(options={}) {
  const connection={host:process.env.SAFFRON_TEST_DB_HOST||process.env.PGHOST||'127.0.0.1',
    port:Number(process.env.SAFFRON_TEST_DB_PORT||process.env.PGPORT||5432),user:process.env.SAFFRON_TEST_DB_USER||process.env.PGUSER||'saffron_incentives_test',
    password:process.env.SAFFRON_TEST_DB_PASSWORD||process.env.PGPASSWORD}
  const name='saffron_incentives_test_'+randomBytes(8).toString('hex')
  const control=new pg.Pool({...connection,database:'postgres',max:1})
  try{await control.query(`CREATE DATABASE "${name}"`)}catch(error){await control.end();throw error}
  const database=createIncentivesDatabase({...options,connection:{...connection,database:name}})
  try{await database.ready}catch(error){await database.close();await control.query(`DROP DATABASE "${name}"`);await control.end();throw error}
  return {database,connection:{...connection,database:name},
    async seed(actor,limitRaw='100000',pairOverride={}) {
      await database.savePair({...pair,...pairOverride},actor)
      await database.saveBudget({id:program.budgetPoolId,revision:0,name:'Test campaign',chainId:4663,rewardAsset:TOKEN,decimals:18,limitRaw,paused:false},actor)
      await database.saveProgram(program,actor)
    },
    async quote(account,{premium='60000',programId=program.id,plan:actualPlan,signer=account.address,principalCents='10000',fee,recoveryHash}={}) {
      const offer=await database.offer(programId)
      const plan=actualPlan??{premium,liquidity:'123456',usdCheckedAt:database.now(),token0:pair.token0,token1:pair.token1,
        sizingBlock:'0x10',sizingBlockHash:'0x'+'1'.repeat(64)}
      return database.putQuote({offer,principalCents,wallet:account.address,origin:ORIGIN,plan,signer,fee,recoveryHash})
    },
    async accept(account,quote) {
      // Database-only tests inject already verified evidence at the service seam.
      // HTTP, EVM and browser tests separately prove actual native ETH payments.
      const payment=mockPayment(quote)
      return database.acceptDeployment({wallet:account.address,quoteId:quote.id,payment,origin:ORIGIN})
    },
    async close(){await database.close();await control.query(`DROP DATABASE "${name}"`);await control.end()},
  }
}

export const mockPayment=quote=>({hash:digest({quoteId:quote.id}),quoteId:quote.id,wallet:quote.wallet,planHash:quote.planHash,verified:true})
