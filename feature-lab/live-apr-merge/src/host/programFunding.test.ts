import { describe,it,expect } from 'vitest'
import { decodeFunctionData,decodeAbiParameters } from 'viem'
import { programFundingTerms,programFundingAction } from './programFunding'
import { abi,FACTORY } from '../../shared/vault-lifecycle.mjs'
import type { Deployment } from '../incentives/model'

const now=Date.now(),vault='0x'+'1'.repeat(40),token='0x'+'2'.repeat(40)
const row=()=>({workerState:'created',plan:{vault,premium:'999999999999999999999'},observation:{
  verified:true,canonical:true,chainId:4663,factory:FACTORY,headTimestamp:Math.floor(now/1000),checkedAt:now,
  initialized:true,vault,isStarted:false,claimSupply:'0',variableCapacity:'1000001',variableSupply:'1',variableBalance:'1',
  variableAsset:token,variableDecimals:6,variableSymbol:'USDG',
}} as Deployment)

describe('admin variable-side funding',()=>{
  it('uses actual bearer remainder and actual token decimals, not the original plan or transferred token balance',()=>{
    const r=row();r.observation.variableBalance='999999999'
    expect(programFundingTerms(r,now)).toMatchObject({remaining:1000000n,token:{decimals:6}})
  })
  it('requires fresh canonical factory evidence and a created, unretired, unstarted request',()=>{
    for(const mutate of [
      (r:Deployment)=>{r.observation.checkedAt=now-20000},(r:Deployment)=>{r.observation.canonical=false},
      (r:Deployment)=>{r.observation.factory=token},(r:Deployment)=>{r.cancelRequested=true},
      (r:Deployment)=>{r.refund={} as any},(r:Deployment)=>{r.observation.isStarted=true},
      (r:Deployment)=>{r.workerState='waiting'},(r:Deployment)=>{r.observation.variableSupply=r.observation.variableCapacity},
    ]){const r=row();mutate(r);expect(()=>programFundingTerms(r,now)).toThrow()}
  })
  it('approves exact remainder, resets a smaller nonzero allowance, and never uses unlimited approval',()=>{
    const terms=programFundingTerms(row(),now)
    for(const [allowance,expected]of [[0n,1000000n],[5n,0n]]){
      const action=programFundingAction(terms,allowance)
      expect(action.to.toLowerCase()).toBe(token)
      expect(decodeFunctionData({abi,data:action.data}).args).toEqual([vault,expected])
    }
  })
  it('deposits variable-side tokens with an exact minimum to reject a competing capacity change',()=>{
    const terms=programFundingTerms(row(),now),action=programFundingAction(terms,1000000n)
    const decoded=decodeFunctionData({abi,data:action.data})
    expect(action.to).toBe(vault);expect(action.value).toBe(0n);expect(decoded.functionName).toBe('deposit')
    const [amount,side,data]=decoded.args as [bigint,bigint,`0x${string}`]
    expect([amount,side]).toEqual([1000000n,1n]);expect(decodeAbiParameters([{type:'uint256'}],data)).toEqual([amount])
  })
})
