import { it } from 'node:test'
import assert from 'node:assert/strict'
import { adminConfiguration } from '../server/admin-configuration.mjs'

const recipient='0x'+'1'.repeat(40)
const protocol={chainId:4663,signerAddress:recipient,vaultTypeId:1,adapterTypeId:2,factoryCodeHash:'0x'+'2'.repeat(64),vaultTypeHash:'0x'+'3'.repeat(64),adapterTypeHash:'0x'+'4'.repeat(64)}
const env={SAFFRON_CREATION_FEE_RECIPIENT:recipient,RPC_ROBINHOOD:'https://rpc.invalid/secret-token',PRICE_API_ROOT:'https://prices.invalid/private-token',SAFFRON_APP_ORIGIN:'https://app.invalid',SAFFRON_ADMIN_WALLETS:recipient,SAFFRON_PROTOCOL_CONFIG:'/private/protocol.json'}
const report=(values=env,config=protocol)=>adminConfiguration(name=>values[name],config)
it('flags all missing required settings without requiring optional PostgreSQL credentials',()=>{
  const {settings}=report({},undefined)
  assert.equal(settings.filter(row=>row.required&&row.status==='missing').length,6)
  assert.equal(settings.find(row=>row.name==='PGPASSWORD').status,'default')
  assert.equal(settings.find(row=>row.name==='BASE_PATH').status,'default')
})
it('rejects missing, blank, malformed and zero fee recipients; never leaks settings or unknown secrets',()=>{
  for(const value of [undefined,'','   ','not-an-address','0x'+'0'.repeat(40)]){
    const result=report({...env,SAFFRON_CREATION_FEE_RECIPIENT:value})
    assert.ok(['missing','invalid'].includes(result.settings[0].status))
  }
  const valid=report({...env,PGPASSWORD:'never-return-this-password',UNRELATED_SECRET:'unknown-secret'})
  assert.ok(valid.settings.every(row=>['configured','default'].includes(row.status)))
  for(const secret of [...Object.values(env),'never-return-this-password','unknown-secret'])assert.ok(!JSON.stringify(valid).includes(secret))
})
it('checks protocol contents, URLs, allowlists, and explicit ports rather than just presence',()=>{
  for(const [key,value] of [['RPC_ROBINHOOD','not-a-url'],['PRICE_API_ROOT','file:///secret'],['SAFFRON_ADMIN_WALLETS',recipient+',bad'],['PGPORT','99999']]){
    assert.equal(report({...env,[key]:value}).settings.find(row=>row.name===key).status,'invalid')
  }
  assert.equal(report(env,{...protocol,chainId:1}).settings.find(row=>row.name==='SAFFRON_PROTOCOL_CONFIG').status,'invalid')
  assert.equal(report(env,{...protocol,signerAddress:null}).settings.find(row=>row.name==='SAFFRON_PROTOCOL_CONFIG').status,'invalid')
})
