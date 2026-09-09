import { keccak256, stringToHex } from 'viem'
import { CASHCAT, POOL } from './evm-fixture.mjs'
import { WETH } from '../shared/vault-lifecycle.mjs'
/** Seed previously verified receipt evidence in a disposable database only. */
export async function seedRequest(database, wallet, extra = {}) {
  const record={version:3,kind:'incentive',chain:'robinhood',depositToken:'USD',pair:'CASHCAT / ETH',depositAmount:'10',wallet,
    id:crypto.randomUUID(),createdAt:new Date().toISOString(),paymentAsset:'USDC',paymentAmount:'2',
    paymentTxHash:keccak256(stringToHex(crypto.randomUUID())),requestDigest:keccak256(stringToHex(crypto.randomUUID())),
    incentive:{id:'cashcat-eth-1000-3d',chainId:4663,poolAddress:POOL,feeTier:10000,
      token0:{address:CASHCAT,symbol:'CASHCAT',decimals:18},token1:{address:WETH,symbol:'ETH',decimals:18},
      durationDays:3,capacityUsd:100000,aprPercent:1000,depositUsd:'10',range:'full'},...extra}
  const saved=await database.save(record)
  return (await database.list({requestId:saved.record.id}))[0]
}
