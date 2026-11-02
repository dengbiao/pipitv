#!/usr/bin/env python3
"""Update only the existing Baidu broker, retaining its private network and secret-file mount."""
from pathlib import Path
import argparse, datetime, hashlib, json, subprocess, tarfile, tempfile, urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/baidu-netdisk-20261101'

REMOTE = r'''
import os, sys, json, subprocess, pathlib, tarfile, hashlib, urllib.request, time, stat
revision, digest, archive = sys.argv[1:]
def run(*args, **kwargs): return subprocess.run(args, check=True, **kwargs)
old = json.loads(subprocess.check_output(['docker','inspect','pipi-broker-broker-1']))[0]
oldenv = dict(v.split('=',1) for v in old['Config']['Env'])
assert not oldenv.get('BAIDU_CLIENT_SECRET'), 'Refusing unexpected inline secret'
assert old['HostConfig']['ReadonlyRootfs'] and old['Config']['User'] == '1000:1000'
assert old['HostConfig']['CapDrop'] == ['ALL']
assert 'no-new-privileges:true' in old['HostConfig']['SecurityOpt']
secret = next(m['Source'] for m in old['Mounts'] if m['Destination']=='/run/secrets/baidu_client_secret')
info = os.lstat(secret)
assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o444
assert old['HostConfig']['PortBindings'] in (None, {})
source = pathlib.Path(old['Config']['Labels']['com.docker.compose.project.working_dir'])
target = source.parent / revision
assert target.parent == source.parent and not target.exists()
target.mkdir(mode=0o700)
with tarfile.open(archive) as bundle:
    assert all(m.name in ('dist/index.js','dist/node-server.js','src/index.ts','src/node-server.ts','manifest.json') and m.isfile() for m in bundle.getmembers())
    bundle.extractall(target, filter='data')
assert hashlib.sha256(pathlib.Path(archive).read_bytes()).hexdigest() == digest
base_image = old['Config']['Image']
assert subprocess.check_output(['docker','image','inspect',base_image,'--format','{{.Id}}'],text=True).strip() == old['Image']
dockerfile = 'FROM '+base_image+'\nCOPY --chown=1000:1000 dist/index.js /app/dist/index.js\nCOPY --chown=1000:1000 dist/node-server.js /app/dist/node-server.js\nENV BUILD_REVISION='+revision+'\nLABEL org.opencontainers.image.revision='+revision+'\nLABEL io.xuanli.deployment.bundle=sha256:'+digest+'\n'
(target/'Dockerfile.runtime-overlay').write_text(dockerfile)
compose = target/'docker-compose.nginx.yml'
compose.write_bytes((source/'docker-compose.nginx.yml').read_bytes())
environment = os.environ.copy()
for name in ('BAIDU_CLIENT_ID','BAIDU_REDIRECT_URI','TOKEN_EXCHANGE_ENABLED'): environment[name] = oldenv[name]
environment['BAIDU_CLIENT_SECRET_HOST_PATH'] = secret
environment['BUILD_REVISION'] = revision
environment['SOURCE_BUNDLE_DIGEST'] = 'sha256:'+digest
def ready():
    with urllib.request.urlopen('https://oauth.dreamcanvas.site/readyz',timeout=10) as response: return json.load(response)
before = ready()
assert before['build_revision'] == oldenv['BUILD_REVISION']
run('docker','build','--network=none','--pull=false','-f',str(target/'Dockerfile.runtime-overlay'),'-t','baidu-token-broker:'+revision,str(target),stdout=subprocess.DEVNULL)
try:
    run('docker','compose','-p','pipi-broker','-f',str(compose),'up','--no-build','--pull','never','--wait','--wait-timeout','45','broker',env=environment)
    after = ready()
    assert after['status'] == 'ready' and after['build_revision'] == revision
    assert after['oauth_coordinate_fingerprint'] == before['oauth_coordinate_fingerprint']
except BaseException:
    environment['BUILD_REVISION'] = oldenv['BUILD_REVISION']
    environment['SOURCE_BUNDLE_DIGEST'] = old['Config']['Labels']['io.xuanli.deployment.bundle']
    run('docker','compose','-p','pipi-broker','-f',str(source/'docker-compose.nginx.yml'),'up','--no-build','--pull','never','--wait','--wait-timeout','45','broker',env=environment)
    raise
report = {'host':'115.190.248.212','previousRevision':before['build_revision'],'revision':revision,'ready':after,
          'previousImage':old['Image'],'bundleSha256':digest,'previousRelease':str(source),'release':str(target),
          'sameOAuthApplication':True,'secretFileUnchanged':True,'unrelatedServicesChanged':False}
(target/'deployment-report.json').write_text(json.dumps(report,indent=2)+'\n')
os.unlink(archive)
print('PIPI_DEPLOY_REPORT='+json.dumps(report),flush=True)
'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--key', required=True, type=Path)
    parser.add_argument('--host', default='115.190.248.212')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply: raise SystemExit('Use --apply after building and testing the service.')
    OUT.mkdir(parents=True, exist_ok=True)
    service = ROOT/'services/baidu-token-broker'
    subprocess.run(['npm','test'],cwd=service,check=True,stdout=subprocess.DEVNULL)
    names = ['dist/index.js','dist/node-server.js','src/index.ts','src/node-server.ts']
    hashes = {name:hashlib.sha256((service/name).read_bytes()).hexdigest() for name in names}
    revision = 'tv-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+hashes['dist/index.js'][:12]
    with tempfile.TemporaryDirectory(prefix='pipi-baidu-broker-') as temporary:
        temp = Path(temporary); manifest = temp/'manifest.json'; manifest.write_text(json.dumps({'revision':revision,'files':hashes}))
        archive = temp/'broker.tar'
        with tarfile.open(archive,'w') as bundle:
            for name in names: bundle.add(service/name,arcname=name)
            bundle.add(manifest,arcname='manifest.json')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        options = ['-i',str(args.key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10']
        remote_archive = '/tmp/pipi-baidu-'+revision+'.tar'
        subprocess.run(['scp',*options,str(archive),'root@'+args.host+':'+remote_archive],check=True)
        remote = subprocess.run(['ssh',*options,'root@'+args.host,'python3 - '+revision+' '+digest+' '+remote_archive],input=REMOTE,text=True,capture_output=True,timeout=120)
        print(remote.stderr.strip())
        report_line = next((line for line in remote.stdout.splitlines() if line.startswith('PIPI_DEPLOY_REPORT=')),None)
        if remote.returncode or not report_line: raise SystemExit('Broker update failed; inspect the retained release and rollback result.')
        report = json.loads(report_line.split('=',1)[1]); (OUT/'broker-deployment.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    # Independent Mac -> public TLS -> broker -> Baidu smoke. Never persist or print device codes.
    request = urllib.request.Request('https://oauth.dreamcanvas.site/oauth/device/code',data=b'{}',headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=20) as response: device = json.load(response)
        assert all(device.get(key) for key in ['device_code','user_code','qrcode_url','verification_url','expires_in','interval'])
        assert device['qrcode_url'].startswith('https://openapi.baidu.com/device/qrcode/') and device['interval'] >= 10
        with urllib.request.urlopen(device['qrcode_url'],timeout=20) as response: image = response.read(1024*1024)
        assert image.startswith(b'\x89PNG') or image.startswith(b'\xff\xd8')
        smoke = {'deviceCodeIssued':True,'qrImageBytes':len(image),'credentialsPersisted':False,'userAuthorized':False}
        (OUT/'broker-smoke.json').write_text(json.dumps(smoke,indent=2)+'\n'); print(json.dumps(smoke))
    except Exception:
        raise SystemExit('Broker is deployed and ready, but the Baidu device-code smoke needs investigation.')

if __name__ == '__main__': main()
