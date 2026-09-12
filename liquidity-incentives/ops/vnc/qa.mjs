/** Send one bounded command to the dedicated QA process; never read its keys. */
import { settings } from './config.mjs'
import { createConnection } from 'node:net'
const action=process.argv[2]??'status'
if(!['status','fund-half','fund','mature','screenshot'].includes(action))throw new Error('Use status, fund-half, fund, mature or screenshot.')
const socket=createConnection(settings.dataRoot+'/run/control.sock')
socket.setTimeout(15000,()=>socket.destroy(new Error('QA command timed out')))
socket.on('connect',()=>socket.write(JSON.stringify({action})+'\n'))
socket.on('data',chunk=>process.stdout.write(chunk))
socket.on('error',()=>{console.error('QA sandbox is unavailable.');process.exitCode=1})
