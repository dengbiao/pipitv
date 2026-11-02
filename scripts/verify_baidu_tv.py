#!/usr/bin/env python3
"""Run cloud-source contracts on the actual TV in a separate app, with a mock provider only."""
from pathlib import Path
import argparse, json, os, shutil, subprocess, time, xml.etree.ElementTree as ET, zipfile
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'outputs/qa/baidu-netdisk-20261101'
BUILD = OUT/'device-fixture'
TOOLS = Path.home()/'.cache/pipitv-tools'
JDK = TOOLS/'amazon-corretto-17.jdk/Contents/Home'
BT = TOOLS/'sdk/android-15'
PLATFORM = TOOLS/'sdk/android-35/android.jar'
PACKAGE = 'com.pipi.kids.baiduqa'
def run(*args): subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
def main():
    global OUT, BUILD, PACKAGE
    parser=argparse.ArgumentParser(); parser.add_argument('--device',default='192.168.1.5:5555');parser.add_argument('--ui-only',action='store_true')
    parser.add_argument('--build-only',action='store_true');parser.add_argument('--package',choices=['com.pipi.kids.baiduqa','com.pipi.kids.qualityqa'],default=PACKAGE)
    parser.add_argument('--output',type=Path,default=OUT);args=parser.parse_args()
    PACKAGE=args.package;OUT=args.output.resolve();BUILD=OUT/'device-fixture'
    if not OUT.is_relative_to(ROOT/'outputs/qa'):raise SystemExit('QA output must stay under outputs/qa.')
    BUILD.mkdir(parents=True,exist_ok=True)
    shutil.copytree(ROOT/'android/build/classes',BUILD/'classes',dirs_exist_ok=True)
    shutil.copytree(ROOT/'android/build/assets/web',BUILD/'assets/web',dirs_exist_ok=True)
    shutil.copy2(ROOT/'outputs/qa/timer-test.mp4',BUILD/'assets/test.mp4');(BUILD/'dex').mkdir(exist_ok=True)
    ns='{http://schemas.android.com/apk/res/android}'; ET.register_namespace('android',ns[1:-1]); manifest=ET.parse(ROOT/'android/AndroidManifest.xml');manifest.getroot().set('package',PACKAGE)
    app=manifest.getroot().find('application');app.set(ns+'label','PIPI 网盘独立验证');app.set(ns+'debuggable','true')
    for activity in app.findall('activity'):
        activity.set(ns+'name','com.pipi.kids'+activity.get(ns+'name'))
        for intent in activity.findall('intent-filter'): activity.remove(intent)
    ET.SubElement(app,'activity',{ns+'name':'com.pipi.kids.BaiduQaActivity',ns+'exported':'true'})
    manifest.write(BUILD/'AndroidManifest.xml',encoding='utf-8',xml_declaration=True)
    run(JDK/'bin/javac','-encoding','UTF-8','-source','8','-target','8','-classpath',str(PLATFORM)+os.pathsep+str(BUILD/'classes'),'-d',BUILD/'classes',ROOT/'android/tests/BaiduQaActivity.java')
    run(JDK/'bin/jar','cf',BUILD/'classes.jar','-C',BUILD/'classes','.')
    run(JDK/'bin/java','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--lib',PLATFORM,'--min-api','21','--output',BUILD/'dex',BUILD/'classes.jar')
    unsigned=BUILD/'unsigned.apk';run(BT/'aapt2','link','-o',unsigned,'-I',PLATFORM,'--manifest',BUILD/'AndroidManifest.xml','-A',BUILD/'assets','-0','m4a',ROOT/'android/build/resources.zip')
    with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (BUILD/'dex').glob('*.dex'): apk.write(dex,dex.name)
    run(BT/'zipalign','-f','4',unsigned,BUILD/'aligned.apk')
    apk=BUILD/'baidu-qa.apk';run(JDK/'bin/java','-jar',BT/'lib/apksigner.jar','sign','--ks',TOOLS/'pipikids-development.keystore','--ks-key-alias','pipikids-dev','--ks-pass','pass:android','--key-pass','pass:android','--out',apk,BUILD/'aligned.apk')
    if args.build_only:print('Disposable QA APK ready: '+str(apk));return
    adb=[str(TOOLS/'platform-tools/adb'),'-s',args.device]
    if args.ui_only:
        run(*adb,'install','-r','--no-incremental',apk);run(*adb,'shell','am','force-stop',PACKAGE)
        run(*adb,'shell','am','start','-n',PACKAGE+'/com.pipi.kids.MainActivity');return
    # Only the explicitly disposable package is reset, never com.pipi.kids.
    subprocess.run(adb+['uninstall',PACKAGE],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    run(*adb,'install','-r','--no-incremental',apk);run(*adb,'shell','am','start','-n',PACKAGE+'/com.pipi.kids.BaiduQaActivity')
    until=time.monotonic()+45
    while time.monotonic()<until:
        result=subprocess.run(adb+['shell','run-as',PACKAGE,'cat','files/baidu-qa-result.json'],capture_output=True,text=True,timeout=10)
        if result.returncode==0 and result.stdout.startswith('{'):
            report=json.loads(result.stdout);report.update({'package':PACKAGE,'provider':'mock in isolated package','originalPinReadOrChanged':False})
            (OUT/'native-contracts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
            if not report['passed']:raise SystemExit(1)
            return
        time.sleep(.3)
    raise SystemExit('Isolated TV verification timed out.')
if __name__=='__main__':main()
