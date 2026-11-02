#!/usr/bin/env python3
"""D-pad smoke test on the authorized TV; never submit, inspect or reset its PIN."""
from pathlib import Path
import datetime
import hashlib
import json
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/remote-navigation'
ADB = [str(Path.home() / '.cache/pipitv-tools/platform-tools/adb'), '-s', '192.168.1.5:5555']
checks = []

def run(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=20)

def focus():
    raw = run('shell', 'dumpsys', 'activity', 'com.pipi.kids/.MainActivity')
    return next((line.split('PIPI_FOCUS=', 1)[1].strip() for line in raw.splitlines() if 'PIPI_FOCUS=' in line), '')

def expect(name, predicate):
    deadline = time.monotonic() + 5
    observed = focus()
    while not predicate(observed) and time.monotonic() < deadline:
        time.sleep(.12)
        observed = focus()
    if not predicate(observed):
        checks.append({'check': name, 'passed': False, 'focus': observed})
        (OUT / 'tv-progress.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
        raise AssertionError(f'{name}: unexpected focus {observed!r}')
    checks.append({'check': name, 'passed': True, 'focus': observed})
    (OUT / 'tv-progress.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
    print('PASS:', name, '—', observed, flush=True)
    return observed

def key(code, longpress=False):
    run('shell', 'input', 'keyevent', *(['--longpress'] if longpress else []), str(code))

def screenshot(name):
    (OUT / name).write_bytes(subprocess.check_output(ADB + ['exec-out', 'screencap', '-p'], timeout=20))

def screen_xml(name):
    run('shell', 'uiautomator', 'dump', '/sdcard/pipi-remote-qa.xml')
    xml = run('shell', 'cat', '/sdcard/pipi-remote-qa.xml')
    (OUT / name).write_text(xml)
    return xml

def main():
    before = json.loads((OUT / 'device-before.json').read_text())
    entries = before['state']['entries']
    assert len(entries) >= 2 and all(entry['kind'] == 'folder' for entry in entries)
    run('shell', 'am', 'force-stop', 'com.pipi.kids')
    run('shell', 'am', 'start', '-n', 'com.pipi.kids/.MainActivity')
    ids = ['entry:' + entry['id'] for entry in entries]
    expect('home starts with a visible default selection', lambda value: value == ids[0])
    key(22); expect('right selects second entry', lambda value: value == ids[1])
    screenshot('tv-home-approved-focus.png')
    for expected_id in ids[2:]:
        key(22); expect('right selects the next entry', lambda value, target=expected_id: value == target)
    key(22); expect('right at row edge stays on the last entry', lambda value: value == ids[-1])
    while focus() != ids[1]:
        key(21); expect('left moves back toward the tested entry', lambda value: value in ids)
    key(23)
    first_file = expect('DPAD_CENTER opens folder and focuses its first item', lambda value: value.startswith('file:' + entries[1]['path'] + '/'))
    assert 'com.pipi.kids/.MainActivity' in run('shell', 'dumpsys', 'activity', 'activities').split('mResumedActivity:')[-1].split('\n')[0], 'One OK unexpectedly launched a second item'
    key(22)
    selected_file = expect('file grid has a synchronized selected item', lambda value: value.startswith('file:' + entries[1]['path'] + '/'))
    screenshot('tv-file-selected.png')
    key(4); expect('Back restores the entry that opened the folder', lambda value: value == ids[1])
    key(66); expect('Enter restores the last selected file', lambda value: value == selected_file)
    key(111); expect('Escape uses the same Back path', lambda value: value == ids[1])
    key(160); expect('numpad Enter shares the same single activation', lambda value: value == selected_file)
    key(4); expect('folder Back returns to its original entry', lambda value: value == ids[1])
    key(19); expect('Up reaches parent management', lambda value: value == '进入家长管理')
    key(23); expect('PIN opens on digit one', lambda value: value == 'pin-1')
    screenshot('tv-pin-default.png')
    for code in [22, 22, 22]: key(code)
    expect('PIN row edge never escapes to a background control', lambda value: value == 'pin-3')
    for code in [20, 20, 20]: key(code)
    expect('PIN confirm is reachable using directions', lambda value: value == 'pin-confirm')
    key(23); expect('empty PIN validation returns focus to digit one', lambda value: value == 'pin-1')
    xml = screen_xml('tv-pin-empty-validation.xml')
    assert '请输入至少 4 位数字' in xml, 'Missing local minimum-length validation'
    screenshot('tv-pin-empty-validation.png')
    key(23, longpress=True)
    xml = screen_xml('tv-pin-single-input.xml')
    assert '已输入 1 位数字' in xml, 'Holding OK did not input exactly one digit'
    checks.append({'check': 'long-press OK inputs exactly one digit', 'passed': True})
    screenshot('tv-pin-single-input.png')
    for code in [20, 20, 20]: key(code)
    expect('PIN delete is reachable using directions', lambda value: value == 'pin-delete')
    key(23)
    xml = screen_xml('tv-pin-deleted.xml')
    assert '已输入 0 位数字' in xml, 'Delete did not remove the test digit'
    checks.append({'check': 'screen Delete removes the temporary single test digit', 'passed': True})
    key(4); expect('Back cancels PIN and restores its trigger', lambda value: value == '进入家长管理')
    key(23); expect('reopened PIN starts on digit one again', lambda value: value == 'pin-1')
    key(4); expect('reopened PIN cancels without an unlock attempt', lambda value: value == '进入家长管理')
    key(20)
    expect('Down returns to the content row', lambda value: value in ids)
    for attempt in range(len(ids)):
        current = focus()
        if current == ids[1]: break
        key(21 if current in ids[2:] else 22)
        expect('focus moves toward the approved reference', lambda value: value in ids)
    assert focus() == ids[1], 'Unable to restore the reference entry'
    screenshot('tv-home-final.png')
    raw = run('shell', 'dumpsys', 'activity', 'com.pipi.kids')
    state = next(json.loads(line.split('PIPI_STATE=', 1)[1]) for line in raw.splitlines() if 'PIPI_STATE=' in line)
    assert state['entries'] == before['state']['entries'], 'Entries or play history changed'
    assert state['settings'] == before['state']['settings'], 'Existing time settings changed'
    home = run('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME').strip()
    assert home == before['home'], 'Default Home changed'
    remote_apk = run('shell', 'pm', 'path', 'com.pipi.kids').strip().split('package:', 1)[1]
    installed_hash = run('shell', shlex.join(['sha256sum', remote_apk])).split()[0]
    assert installed_hash == hashlib.sha256((ROOT / 'outputs/PIPI-KIDS-0.1.0-dev.apk').read_bytes()).hexdigest(), 'Installed APK differs from the reviewed build'
    report = {'checkedAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
      'device': '192.168.1.5:5555', 'method': 'ADB simulated keyevents on actual Hisense TV / Chromium 83',
      'checks': checks, 'installedApkSha256': installed_hash, 'existingEntriesAndPlayHistoryUnchanged': True,
      'existingTimeSettingsUnchanged': True, 'defaultHomeUnchanged': True, 'pinReadOrReset': False,
      'realPinUnlockAttempted': False, 'physicalRemoteAcceptance': 'pending user',
      'parentSettingsAndEditorOnTv': 'pending user unlock; covered using disposable in-memory browser fixture'}
    (OUT / 'tv-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': len(checks), 'installedApkSha256': installed_hash, 'dataAndHomePreserved': True}, ensure_ascii=False))

if __name__ == '__main__': main()
