"""Archive one disposable QA test before resetting it; never print private data.

PostgreSQL, local Anvil state, and test permit files are encrypted directly to
the existing password-store recipient. No plaintext database/archive is written.
This is a test evidence snapshot, not recovery of in-memory generated keys.
"""
from pathlib import Path
import hashlib,io,json,os,re,subprocess,sys,tarfile,urllib.request

os.umask(0o077)
payload=json.load(sys.stdin)
reset_id=payload['id']
if not re.fullmatch(r'[0-9a-f-]{36}',reset_id):
    raise RuntimeError('Invalid test archive identifier')
config=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import { settings } from './config.mjs'; process.stdout.write(JSON.stringify(settings))"],cwd=Path(__file__).parent,text=True))
root=Path(config['dataRoot'])
destination=root/'resets'/reset_id
destination.mkdir(parents=True,exist_ok=True,mode=0o700)
state=payload['before']
if state['environment']!='Disposable local contracts; NOT mainnet' or state['chainId']!=4663:
    raise RuntimeError('Only the disposable test can be archived')
unit=config['unitPrefix']+'-browser.service'
pid=int(subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True))
if pid<=0:
    raise RuntimeError('Original fixture is not running')

# The fixed Unix socket belongs to the dedicated test cluster, not production.
pg=['-h',str(root/'socket'),'-p',str(config['pgPort']),'-U',config['pgUser'],'-w']
names=subprocess.check_output([str(Path(config['pgBin'])/'psql'),*pg,'-d','postgres','-Atc',
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname"],stderr=subprocess.PIPE,text=True).splitlines()
if len(names)!=1 or not re.fullmatch(r'saffron_incentives_test_[0-9a-f]{16}',names[0]):
    raise RuntimeError('Expected exactly one disposable fixture database')
database=names[0]
dump=subprocess.check_output([str(Path(config['pgBin'])/'pg_dump'),*pg,'-d',database,'-Fc'],stderr=subprocess.PIPE,timeout=30)
listing=subprocess.run([str(Path(config['pgBin'])/'pg_restore'),'--list'],input=dump,capture_output=True,timeout=10)
if listing.returncode:
    raise RuntimeError('Test database snapshot validation failed')

# Resolve Anvil by process ancestry, not by a guessed RPC port or environment.
# Only a loopback listener owned by this exact fixture's child may be queried.
def descendant(child):
    seen=set()
    while child>1 and child not in seen:
        if child==pid:return True
        seen.add(child)
        status=Path(f'/proc/{child}/status').read_text()
        child=int(re.search(r'^PPid:\s+(\d+)',status,re.M).group(1))
    return False

ports=[]
for line in subprocess.check_output(['ss','-ltnpH'],text=True).splitlines():
    owner=re.search(r'\("anvil",pid=(\d+),',line)
    if owner and descendant(int(owner.group(1))):
        address=line.split()[3]
        if not re.fullmatch(r'127\.0\.0\.1:\d+',address):
            raise RuntimeError('Test Anvil must listen on loopback only')
        ports.append(address)
if len(ports)!=1:raise RuntimeError('Expected one local fixture Anvil')
def rpc(method):
    request=urllib.request.Request('http://'+ports[0],data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':[] if method=='anvil_dumpState' else ['latest',False]}).encode(),headers={'content-type':'application/json'})
    with urllib.request.urlopen(request,timeout=15) as response:value=json.load(response)
    if 'error' in value:raise RuntimeError('Local chain snapshot failed')
    return value['result']
chain={'state':rpc('anvil_dumpState'),'head':rpc('eth_getBlockByNumber')}

recipients=[line.strip() for line in Path(config['archiveRecipientsFile']).read_text().splitlines() if line.strip() and not line.startswith('#')]
if not recipients:raise RuntimeError('Backup encryption recipient unavailable')
archive=destination/'test-state.tar.gz.gpg'
if archive.exists():raise RuntimeError('Refusing to replace an existing test archive')
command=['gpg','--batch','--trust-model','always','--encrypt','--output',str(archive)]
for recipient in recipients:command+=['--recipient',recipient]
encrypt=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
with tarfile.open(fileobj=encrypt.stdin,mode='w|gz',dereference=False) as tar:
    for name,data in [('status.json',json.dumps(state,indent=2).encode()),('database.dump',dump),('anvil-state.json',json.dumps(chain).encode())]:
        member=tarfile.TarInfo(name);member.mode=0o600;member.size=len(data)
        tar.addfile(member,io.BytesIO(data))
    permits=root/'run/permits'
    if permits.exists():tar.add(permits,arcname='test-permits')
encrypt.stdin.close()
diagnostic=encrypt.stderr.read()
if diagnostic:(destination/'encrypt.log').write_bytes(diagnostic)
if encrypt.wait()!=0:raise RuntimeError('Test archive encryption failed')

# Read every encrypted archive member back before allowing destruction of the
# old fixture. Private contents stay inside the stream reader and are not logged.
decrypt=subprocess.Popen(['gpg','--batch','--quiet','--decrypt',str(archive)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
count=0
with tarfile.open(fileobj=decrypt.stdout,mode='r|gz') as tar:
    for member in tar:
        if member.isfile():
            source=tar.extractfile(member)
            while source.read(1024*1024):pass
        count+=1
decrypt.stdout.close();diagnostic=decrypt.stderr.read()
if diagnostic:(destination/'verify.log').write_bytes(diagnostic)
if decrypt.wait()!=0:raise RuntimeError('Encrypted archive verification failed')
manifest={'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
    'bytes':archive.stat().st_size,'verifiedMembers':count,'database':database,'databaseArchiveValidated':True,
    'chainId':4663,'chainEnvironment':'disposable local; NOT mainnet','blockNumber':str(int(chain['head']['number'],16)),
    'blockTimestamp':str(int(chain['head']['timestamp'],16)),'originalFixturePid':pid,
    'generatedPrivateKeysIncluded':False,'note':'Evidence snapshot; generated wallet keys remain memory-only and are discarded by a fresh test.'}
(destination/'archive-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(destination/'test-record.json').write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps(manifest))
