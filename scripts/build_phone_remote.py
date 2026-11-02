#!/usr/bin/env python3
"""Build the Android phone Bluetooth mouse using the already-cached official toolchain."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'phone-remote'
TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
BUILD_TOOLS = TOOLS / 'sdk/android-15'
PLATFORM = TOOLS / 'sdk/android-35/android.jar'
BUILD = APP / 'build'
OUTPUT = ROOT / 'outputs/PIPI-REMOTE-0.1.0.apk'

def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, cwd=ROOT, **kwargs)

def main():
    for p in [JDK/'bin/javac', BUILD_TOOLS/'aapt2', PLATFORM]:
        if not p.exists(): raise SystemExit('Missing toolchain. Run scripts/prepare_android.py.')
    if BUILD.exists(): shutil.rmtree(BUILD)
    for folder in ['classes', 'dex', 'test-classes', 'generated', 'assets/licenses']:
        (BUILD/folder).mkdir(parents=True,exist_ok=True)
    for license_file in (APP/'licenses').glob('*'):
        shutil.copy2(license_file,BUILD/'assets/licenses'/license_file.name)
    shutil.copy2(APP/'THIRD_PARTY_NOTICES.md',BUILD/'assets/THIRD_PARTY_NOTICES.md')
    run(BUILD_TOOLS/'aapt2','compile','--dir',APP/'res','-o',BUILD/'resources.zip')
    unsigned=BUILD/'unsigned.apk'
    run(BUILD_TOOLS/'aapt2','link','-o',unsigned,'-I',PLATFORM,'--manifest',APP/'AndroidManifest.xml','--java',BUILD/'generated','-A',BUILD/'assets',BUILD/'resources.zip')
    sources=list((APP/'src').rglob('*.java'))+list((BUILD/'generated').rglob('*.java'))
    run(JDK/'bin/javac','-encoding','UTF-8','-source','8','-target','8','-classpath',PLATFORM,'-d',BUILD/'classes',*sources)
    run(JDK/'bin/jar','cf',BUILD/'classes.jar','-C',BUILD/'classes','.')
    run(JDK/'bin/java','-cp',BUILD_TOOLS/'lib/d8.jar','com.android.tools.r8.D8','--lib',PLATFORM,'--min-api','28','--output',BUILD/'dex',BUILD/'classes.jar')
    with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (BUILD/'dex').glob('*.dex'): apk.write(dex,dex.name)
    aligned=BUILD/'aligned.apk'
    run(BUILD_TOOLS/'zipalign','-f','4',unsigned,aligned)
    key=TOOLS/'pipikids-development.keystore'
    if not key.exists():
        run(JDK/'bin/keytool','-genkeypair','-keystore',key,'-storetype','JKS','-storepass','android','-keypass','android','-alias','pipikids-dev','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=PIPI Local Development','-noprompt')
    signed=BUILD/'signed.apk'
    run(JDK/'bin/java','-jar',BUILD_TOOLS/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias','pipikids-dev','--ks-pass','pass:android','--key-pass','pass:android','--out',signed,aligned)
    run(JDK/'bin/java','-jar',BUILD_TOOLS/'lib/apksigner.jar','verify','--verbose',signed)
    pure=[APP/'src/com/pipi/remote'/n for n in ['HidReports.java','GestureLogic.java']]
    run(JDK/'bin/javac','-encoding','UTF-8','-d',BUILD/'test-classes',*pure,APP/'tests/RemoteLogicTest.java')
    tests=run(JDK/'bin/java','-cp',BUILD/'test-classes','com.pipi.remote.RemoteLogicTest',capture_output=True,text=True).stdout.strip()
    print(tests)
    badging=run(BUILD_TOOLS/'aapt2','dump','badging',signed,capture_output=True,text=True).stdout
    if "package: name='com.pipi.remote'" not in badging or not re.search(r"^(?:minSdkVersion|sdkVersion):'28'$",badging,re.M):
        raise RuntimeError('APK package / minimum SDK verification failed')
    if "targetSdkVersion:'35'" not in badging:
        raise RuntimeError('APK target SDK verification failed')
    if 'android.permission.INTERNET' in badging or 'android.permission.ACCESS_FINE_LOCATION' in badging:
        raise RuntimeError('Unexpected networking or location permission')
    OUTPUT.parent.mkdir(exist_ok=True)
    staging=OUTPUT.with_suffix('.apk.tmp');shutil.copy2(signed,staging);os.replace(staging,OUTPUT)
    report={'package':'com.pipi.remote','version':'0.1.0','minAndroidApi':28,'targetApi':35,'bytes':OUTPUT.stat().st_size,
        'sha256':hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),'logicTests':tests,'signatureVerified':True,
        'realPhoneBluetoothVerified':False,'requiresTvApp':False,'requiresNetworkPermission':False,
        'reference':'https://github.com/Devdas-gupta/linkpad','referenceLicense':'MIT'}
    (ROOT/'outputs/phone-remote-build.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('Phone APK ready:',OUTPUT)

if __name__=='__main__': main()
