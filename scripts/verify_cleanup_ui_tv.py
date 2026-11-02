#!/usr/bin/env python3
"""Remote-only removal/restoration acceptance in a disposable app, never production."""
from pathlib import Path
import importlib.util, json

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('baidu_remote_qa', ROOT/'scripts/verify_baidu_ui_tv.py')
qa = importlib.util.module_from_spec(spec); spec.loader.exec_module(qa)
qa.PACKAGE = 'com.pipi.kids.qualityqa'; qa.OUT = ROOT/'outputs/qa/baidu-quality-cleanup-20261101'

def move(direction, target, limit=7):
    for _ in range(limit):
        if qa.focus() == target: return
        qa.key(direction)
    qa.wait('remote can reach '+target, lambda: qa.focus() == target)

def state():
    return next(json.loads(line.split('PIPI_STATE=', 1)[1]) for line in qa.dump().splitlines() if 'PIPI_STATE=' in line)

qa.adb('shell', 'am', 'force-stop', qa.PACKAGE)
qa.adb('shell', 'am', 'start', '-n', qa.PACKAGE+'/com.pipi.kids.MainActivity')
qa.wait('isolated home is ready', lambda: qa.focus() == 'entry:fixture-local' and qa.PACKAGE+'/' in qa.foreground())
qa.key(23); qa.wait('local media still starts natively', lambda: 'ready=true' in qa.dump() and 'playing=true' in qa.dump())
qa.key(23); qa.wait('OK pauses local playback', lambda: 'playing=false' in qa.dump() and 'hud=true' in qa.dump())
qa.key(4); qa.key(4); qa.wait('Back returns to the local library', lambda: qa.focus().startswith('file:'))
qa.key(4); qa.wait('Back restores the original home series', lambda: qa.focus() == 'entry:fixture-local')
qa.key(19); qa.key(23); qa.wait('only the disposable PIN keypad is open', lambda: qa.focus() == 'pin-1')
for code in [22,23,20,21,23,22,22,23,20,21,23]: qa.key(code)
qa.wait('parent toolbar is ready', lambda: qa.focus() == 'scan-paths')
qa.capture('tv-content-toolbar.png')
qa.key(20)
move(22, 'delete:fixture-local', 3)
qa.key(23); qa.wait('deletion defaults to Cancel', lambda: qa.focus() == '取消')
qa.capture('tv-delete-confirm.png')
qa.key(4); qa.wait('Back cancels deletion and restores its trigger', lambda: qa.focus() == 'delete:fixture-local')
qa.key(23); qa.wait('confirmation opens again', lambda: qa.focus() == '取消')
qa.key(22); qa.key(23)
qa.wait('deletion removes the entry from child access and content management', lambda: state()['entries'][0].get('removed') is True and qa.focus() == 'source:local')
move(22, 'catalog-cleanup')
qa.key(23); qa.wait('cleanup manager opens with its close control selected', lambda: qa.focus() == 'cleanup-close')
qa.key(20); qa.wait('deleted entry can be selected for restoration', lambda: qa.focus() == 'restore:fixture-local')
qa.capture('tv-restore-entry.png')
qa.key(23); qa.wait('restoration retains the same entry ID and returns focus safely', lambda: state()['entries'][0].get('removed') is False and qa.focus() == 'cleanup-close')
qa.key(4); qa.wait('Back closes management and returns to its toolbar trigger', lambda: qa.focus() == 'catalog-cleanup')
move(21, 'source:baidu')
qa.key(23); move(22, 'baidu-connect')
qa.key(23); qa.wait('cloud QR remains operable after the toolbar additions', lambda: qa.focus() == '刷新二维码', timeout=25)
qa.key(4); qa.wait('Back cancels QR and restores the connection button', lambda: qa.focus() == 'baidu-connect')
report = {'passed':True,'package':qa.PACKAGE,'checks':qa.checks,'originalPinReadOrChanged':False}
(qa.OUT/'native-ui.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'passed':True,'checks':len(qa.checks)}, ensure_ascii=False))
