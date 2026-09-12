/** Start dedicated Linux QA services without restarting an existing test.
 * --init creates only a missing disposable cluster and its local test role. */
import { execFileSync } from 'node:child_process'
import { existsSync,mkdirSync,cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { settings as c,app } from './config.mjs'

if(process.platform!=='linux'||process.getuid()!==0)throw Error('VNC hosting requires Linux root; use npm run demo for portable testing.')
if(process.argv.slice(2).some(a=>a!=='--init'))throw Error('Use start-qa.sh [--init]')
const directory=fileURLToPath(new URL('.',import.meta.url))
const run=(command,args)=>execFileSync(command,args,{stdio:'pipe',encoding:'utf8'})
const expected=run('git',['-C',app,'rev-parse','HEAD']).trim()
run('git',['-C',app,'diff','--quiet','HEAD','--','.'])
const unit=part=>c.unitPrefix+'-'+part+'.service'
const active=part=>{try{return run('systemctl',['is-active',unit(part)]).trim()==='active'}catch{return false}}
/** Only reviewed configuration reaches service commands, never browser input. */
function start(part,args,properties=[],env=[]){
  if(active(part))return
  run('systemd-run',['--unit='+unit(part),'--description=Disposable vault QA '+part,
    ...properties.map(p=>'--property='+p),...env.map(e=>'--setenv='+e),'--',...args])
}
if(!existsSync(c.dataRoot+'/postgres/PG_VERSION')){
  if(!process.argv.includes('--init'))throw Error('Initialize the dedicated cluster with --init first.')
  mkdirSync(c.dataRoot,{recursive:true,mode:0o711})
  for(const path of ['postgres','socket']){
    mkdirSync(c.dataRoot+'/'+path,{mode:0o700});run('chown',['postgres:postgres',c.dataRoot+'/'+path])
  }
  run('/usr/sbin/runuser',['-u','postgres','--',c.pgBin+'/initdb','-D',c.dataRoot+'/postgres','--auth-local=trust','--auth-host=reject'])
}
start('postgres',[c.pgBin+'/postgres','-D',c.dataRoot+'/postgres','-p',String(c.pgPort),'-k',c.dataRoot+'/socket','-c','listen_addresses='],['User=postgres','Group=postgres','Restart=on-failure'])
const pg=['-h',c.dataRoot+'/socket','-p',String(c.pgPort),'-U','postgres','-d','postgres','-w']
for(let attempt=0;;attempt++){
  try{run(c.pgBin+'/psql',[...pg,'-Atc','SELECT 1']);break}catch{if(attempt===50)throw Error('Disposable PostgreSQL did not start');await delay(100)}
}
if(process.argv.includes('--init')){
  const present=run(c.pgBin+'/psql',[...pg,'-Atc',"SELECT 1 FROM pg_roles WHERE rolname='"+c.pgUser+"'"]).trim()
  if(!present)run(c.pgBin+'/psql',[...pg,'-v','ON_ERROR_STOP=1','-c','CREATE ROLE '+c.pgUser+' LOGIN CREATEDB'])
}
start('display',['/usr/bin/Xtigervnc',':'+c.display,'-geometry','1440x1020','-depth','24','-rfbport',String(c.rfbPort),'-localhost','-SecurityTypes','None','-AlwaysShared','-AcceptCutText=0','-SendCutText=0','-nolisten','tcp','-ac'],['Restart=on-failure'])
start('vnc',['/usr/bin/websockify','--web='+c.noVncRoot,'--heartbeat=30','127.0.0.1:'+c.viewerPort,'127.0.0.1:'+c.rfbPort],['Restart=on-failure'])
const hostEnv=process.env.SAFFRON_QA_CONFIG?['SAFFRON_QA_CONFIG='+process.env.SAFFRON_QA_CONFIG]:[]
// Pin static files as well as source. Later builds must not change this test's UI.
if(!active('browser')){
  if(!existsSync(app+'/dist/index.html'))throw Error('Build the reviewed production UI first.')
  cpSync(app+'/dist',c.dataRoot+'/build',{recursive:true})
}
start('browser',[process.execPath,directory+'run-sandbox.mjs'],['WorkingDirectory='+app,'Restart=no','KillMode=mixed','TimeoutStopSec=30','IPAddressDeny=any','IPAddressAllow=localhost'],
  [...hostEnv,'DIST_DIR='+c.dataRoot+'/build','DISPLAY=:'+c.display,'SAFFRON_TEST_DB_HOST='+c.dataRoot+'/socket','SAFFRON_TEST_DB_PORT='+c.pgPort,'SAFFRON_TEST_DB_USER='+c.pgUser,'SAFFRON_QA_EXPECTED_COMMIT='+expected])
start('web',[process.execPath,directory+'serve-qa.mjs'],['Restart=on-failure'],hostEnv)
console.log('Dedicated QA services started or preserved. Use qa.mjs status to inspect readiness.')
