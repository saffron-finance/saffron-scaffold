import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readPayments,savePayment,selectPayment,paymentRecordsKey } from '../src/host/payment-records.mjs'
const wallet='0x'+'1'.repeat(40)
function fixture(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}}
const payment=()=>({quote:{id:randomUUID(),wallet,planHash:'terms'},recoverySecret:'private-fixture-capability',sent:false,status:'prepared'})

it('stale tabs cannot erase submitted recovery or change committed terms',()=>{
  const storage=fixture(),stale=readPayments(storage,wallet),record=payment()
  let ledger=savePayment(storage,wallet,stale,record)
  ledger=savePayment(storage,wallet,ledger,{...record,sent:true,status:'submitted',hash:'existing-hash'})
  assert.throws(()=>savePayment(storage,wallet,stale,{...record,status:'abandoned'},{active:false}),/another tab/)
  assert.throws(()=>savePayment(storage,wallet,ledger,{...record,status:'abandoned'},{active:false}),/cannot be discarded/)
  assert.throws(()=>savePayment(storage,wallet,ledger,{...record,quote:{...record.quote,planHash:'changed'}}),/cannot be overwritten/)
  const second=payment();ledger=savePayment(storage,wallet,ledger,second)
  assert.equal(Object.keys(ledger.records).length,2)
  ledger=selectPayment(storage,wallet,ledger,record.quote.id)
  assert.equal(ledger.activeId,record.quote.id)
  assert.equal(readPayments(storage,wallet).records[record.quote.id].hash,'existing-hash')
})

it('acceptance clears only the active pointer and atomically retains payment history',()=>{
  const storage=fixture(),record=payment()
  let ledger=savePayment(storage,wallet,readPayments(storage,wallet),record)
  ledger=savePayment(storage,wallet,ledger,{...record,sent:true,status:'accepted',deploymentId:randomUUID()},{active:false})
  const next=payment();ledger=savePayment(storage,wallet,ledger,next)
  assert.equal(ledger.activeId,next.quote.id);assert.equal(Object.keys(ledger.records).length,2)
  assert.equal(readPayments(storage,'0x'+'2'.repeat(40)).activeId,null)
})

it('storage failures and corrupt data fail closed instead of producing an empty payment slot',()=>{
  const storage=fixture(),record=payment(),ledger=readPayments(storage,wallet)
  assert.throws(()=>savePayment({...storage,setItem:()=>{throw new Error('Storage quota exceeded')}},wallet,ledger,record),/quota/)
  storage.setItem(paymentRecordsKey(wallet),'not json');assert.throws(()=>readPayments(storage,wallet),/unreadable/)
  storage.setItem(paymentRecordsKey(wallet),JSON.stringify({revision:1,activeId:record.quote.id,records:{}}));assert.throws(()=>readPayments(storage,wallet),/invalid/)
})
