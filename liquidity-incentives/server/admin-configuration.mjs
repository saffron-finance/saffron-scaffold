import { isAddress,zeroAddress } from 'viem'

const present=value=>typeof value==='string'&&value.trim().length>0
const address=value=>isAddress(value)&&value.toLowerCase()!==zeroAddress
const httpUrl=value=>{try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
const port=value=>/^\d+$/.test(value)&&Number(value)>0&&Number(value)<=65535
const hash=value=>/^0x[0-9a-fA-F]{64}$/.test(value??'')

/** Inspect effective startup settings, never serialize environment values.
 * This is configuration validation, not a network/DB/worker health check.
 * The caller must expose this report only after operator authentication.
 */
export function adminConfiguration(configured,protocol){
  const settings=[]
  function check(name,valid,impact,{required=true,fallback=false}={}){
    const value=configured(name),exists=present(value)
    settings.push({name,required,status:exists?(valid(value)?'configured':'invalid'):(fallback?'default':'missing'),impact})
  }
  check('SAFFRON_CREATION_FEE_RECIPIENT',value=>address(value.trim()),'New paid requests are blocked. Set a non-zero ETH recipient address, then restart the API.')
  check('RPC_ROBINHOOD',httpUrl,'Pool checks, quotes, and chain reads are blocked. Set the Robinhood RPC endpoint, then restart the API.')
  check('PRICE_API_ROOT',httpUrl,'LP valuation and request sizing are blocked. Set the token price service URL, then restart the API. This does not change fixed ETH request fees.')
  check('SAFFRON_APP_ORIGIN',httpUrl,'Wallet sign-in and protected actions require the public application origin. Set it and restart the API.')
  check('SAFFRON_ADMIN_WALLETS',value=>value.split(',').every(address),'Operator access requires a comma-separated list of valid wallet addresses, without spaces. Set it and restart the API.')
  check('SAFFRON_PROTOCOL_CONFIG',()=>Boolean(protocol&&address(protocol.signerAddress??'')&&Number(protocol.chainId)===4663
    &&['factoryCodeHash','vaultTypeHash','adapterTypeHash'].every(key=>hash(protocol[key]))
    &&['vaultTypeId','adapterTypeId'].every(key=>/^\d+$/.test(String(protocol[key]??'')))),
  'Vault creation requires a readable protocol file with the Robinhood chain ID, public signer address, type IDs, and code hashes. Check the file and restart the API.')
  // PostgreSQL has legitimate libpq defaults, including passwordless local peer
  // authentication. A missing password is not evidence of a broken database.
  for(const name of ['PGHOST','PGUSER','PGDATABASE','PGPASSWORD'])check(name,()=>true,'Uses PostgreSQL connection defaults when omitted. Database availability is checked separately.',{required:false,fallback:true})
  check('PGPORT',port,'Uses PostgreSQL port 5432 when omitted. An explicit port must be between 1 and 65535.',{fallback:true})
  check('PORT',port,'Uses API port 3201 when omitted. An explicit port must be between 1 and 65535.',{fallback:true})
  for(const name of ['BIND_HOST','DIST_DIR'])check(name,()=>true,'Uses the application default when omitted.',{required:false,fallback:true})
  check('BASE_PATH',value=>/^\/[a-zA-Z0-9/_-]*$/.test(value),'Uses the site root when omitted. This must match the frontend build mount.',{required:false,fallback:true})
  return {checkedAt:new Date().toISOString(),settings}
}
