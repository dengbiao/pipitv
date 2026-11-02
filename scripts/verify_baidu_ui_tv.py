#!/usr/bin/env python3
"""Remote-only UI and local-playback regression in the disposable Baidu QA package."""
from pathlib import Path
import argparse, json, subprocess, time
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'outputs/qa/baidu-netdisk-20261101'
PACKAGE='com.pipi.kids.baiduqa';ADB=[str(Path.home()/'.cache/pipitv-tools/platform-tools/adb'),'-s','192.168.1.5:5555']
checks=[]
def adb(*args):return subprocess.check_output(ADB+list(args),text=True,timeout=20).strip()
def dump():return adb('shell','dumpsys','activity',PACKAGE)
def focus():return next((line.split('PIPI_FOCUS=',1)[1].strip() for line in dump().splitlines() if 'PIPI_FOCUS=' in line),'')
def foreground():return next((line.strip() for line in adb('shell','dumpsys','activity','activities').splitlines() if 'mResumedActivity:' in line),'')
def key(code):
    if PACKAGE+'/' not in foreground():raise RuntimeError('QA no longer owns TV foreground; no input sent.')
    adb('shell','input','keyevent',str(code))
def wait(name,predicate,timeout=12):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if predicate():checks.append(name);print('PASS',name,flush=True);return
        time.sleep(.2)
    raise AssertionError(name+'; focus='+focus())
def capture(name): (OUT/name).write_bytes(subprocess.check_output(ADB+['exec-out','screencap','-p'],timeout=20))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--parent-only',action='store_true');args=parser.parse_args()
    adb('shell','am','force-stop',PACKAGE)
    adb('shell','am','start','-n',PACKAGE+'/com.pipi.kids.MainActivity')
    wait('isolated home loads in the real TV WebView',lambda:focus()=='entry:fixture-local')
    if not args.parent_only:
        key(23);wait('local video still reaches native playback after cloud integration',lambda:'PIPI_PLAYER kind=video ready=true' in dump() and 'playing=true' in dump())
        time.sleep(1);key(23);wait('OK pauses local playback and exposes its HUD',lambda:'playing=false' in dump() and 'hud=true' in dump())
        key(4);wait('Back first closes the playback HUD',lambda:'hud=false' in dump())
        key(4);wait('Back returns from the player to its prepared library',lambda:PACKAGE+'/com.pipi.kids.MainActivity' in foreground() and focus().startswith('file:'))
        key(4);wait('Back from the library restores the original home card',lambda:focus()=='entry:fixture-local')
    key(19);wait('parent entry remains reachable with the remote',lambda:focus()=='进入家长管理')
    key(23);wait('only the disposable PIN screen is opened',lambda:focus()=='pin-1')
    for code in [22,23,20,21,23,22,22,23,20,21,23]:key(code)
    wait('the disposable four-digit PIN opens parent content management',lambda:focus()=='scan-paths')
    capture('tv-parent-local.png')
    key(23);wait('local scan paths still open from the compact toolbar',lambda:focus()=='添加扫描路径')
    key(4);wait('Back closes scan paths and restores its toolbar button',lambda:focus()=='scan-paths')
    key(21);wait('Left reaches local rescan',lambda:focus()=='rescan-local')
    key(21);wait('the cloud source is beside the local toolbar actions',lambda:focus()=='source:baidu')
    key(23);wait('switching sources keeps focus on the selected source',lambda:focus()=='source:baidu')
    key(22);wait('Right reaches the cloud connection control',lambda:focus()=='baidu-connect')
    capture('tv-parent-baidu.png')
    key(23);wait('the QR dialog loads with a persistent remote selection',lambda:focus()=='刷新二维码',timeout=25)
    capture('tv-qr-dialog.png')
    key(4);wait('Back cancels QR authorization and restores its trigger',lambda:focus()=='baidu-connect')
    key(21);wait('cloud toolbar returns Left to its source switch',lambda:focus()=='source:baidu')
    key(21);wait('local source remains reachable',lambda:focus()=='source:local')
    key(23);key(22);key(22);wait('switching back restores the local scan actions',lambda:focus()=='rescan-local')
    report={'package':PACKAGE,'passed':True,'checks':checks,'actualCloudAccountAuthorized':False,'originalPinReadOrChanged':False}
    (OUT/'native-ui.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
