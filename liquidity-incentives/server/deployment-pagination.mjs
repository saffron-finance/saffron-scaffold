import { fault } from '../shared/incentives.mjs'

export function deploymentPage({limit=25,cursor=null}={}){
  const size=typeof limit==='string'&&/^[1-9][0-9]*$/.test(limit)?Number(limit):limit
  if(!Number.isSafeInteger(size)||size<1||size>100)throw fault(400,'Page size must be between 1 and 100.')
  if(cursor===null)return {limit:size,after:null}
  try{
    if(typeof cursor!=='string'||cursor.length>256||!/^[-_a-zA-Z0-9]+$/.test(cursor))throw new Error()
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))
    if(!Array.isArray(value)||value.length!==2
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value[0])
      ||new Date(value[0]).toISOString().slice(0,19)!==value[0].slice(0,19)
      ||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value[1]))throw new Error()
    return {limit:size,after:value}
  }catch{throw fault(400,'Invalid deployment page cursor.')}
}

export const deploymentCursor=row=>Buffer.from(JSON.stringify([row.cursor_time,row.id])).toString('base64url')
