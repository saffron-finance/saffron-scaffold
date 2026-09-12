/** Host-owned non-secret configuration. Browser callers cannot set paths,
 * service names, ports, or command arguments. Defaults are loopback-only. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const input=process.env.SAFFRON_QA_CONFIG?JSON.parse(readFileSync(process.env.SAFFRON_QA_CONFIG,'utf8')):{}
export const settings={dataRoot:'/var/lib/saffron-vault-watcher-qa',prefix:'/saffron/apps/vault-watcher-test',
  publicOrigin:null,webPort:8933,viewerPort:8932,debugPort:8934,rfbPort:5992,display:92,
  pgPort:55481,pgUser:'saffron_watcher_test',pgBin:'/usr/lib/postgresql/16/bin',
  unitPrefix:'saffron-vault-watcher-qa',noVncRoot:'/usr/share/novnc',archiveRecipientsFile:'/root/.password-store/.gpg-id',...input}
export const app=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'')
for(const key of ['webPort','viewerPort','debugPort','rfbPort','pgPort'])if(!Number.isInteger(settings[key])||settings[key]<1024||settings[key]>65535)throw Error('Invalid QA port')
for(const key of ['dataRoot','pgBin','noVncRoot','archiveRecipientsFile'])if(!settings[key].startsWith('/')||/[\r\n\0]/.test(settings[key]))throw Error('Invalid QA host path')
if(!/^[a-z][a-z0-9-]*$/.test(settings.unitPrefix)||!Number.isInteger(settings.display)||settings.display<1)throw Error('Invalid QA service identity')
if(!/^[a-z][a-z0-9_]*$/.test(settings.pgUser))throw Error('Invalid disposable database role')
if(!/^\/[a-zA-Z0-9/_-]+$/.test(settings.prefix))throw Error('Invalid QA route')
if(settings.publicOrigin&&new URL(settings.publicOrigin).origin!==settings.publicOrigin)throw Error('QA origin must not include a path')
