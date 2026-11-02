#!/usr/bin/env python3
"""Verify the TV player through real remote keys, without changing parent settings."""
from pathlib import Path
import datetime
import hashlib
import json
import re
import shlex
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/player-simplification'
ADB = [str(Path.home() / '.cache/pipitv-tools/platform-tools/adb'), '-s', '192.168.1.5:5555']
checks = []


def run(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=20)


def snapshot():
    # Exact components exclude older isolated QA packages with the same prefix.
    main = run('shell', 'dumpsys', 'activity', 'com.pipi.kids/.MainActivity')
    native = run('shell', 'dumpsys', 'activity', 'com.pipi.kids/.MediaActivity')
    state = next(json.loads(l.split('PIPI_STATE=', 1)[1]) for l in main.splitlines() if 'PIPI_STATE=' in l)
    player = next((l.strip() for l in native.splitlines() if 'PIPI_PLAYER ' in l), '')
    focus = next((l.split('PIPI_PLAYER_FOCUS=', 1)[1].strip() for l in native.splitlines() if 'PIPI_PLAYER_FOCUS=' in l), '')
    home_focus = next((l.split('PIPI_FOCUS=', 1)[1].strip() for l in main.splitlines() if 'PIPI_FOCUS=' in l), '')
    return state, player, focus, home_focus


def key(code, long=False):
    active = run('shell', 'dumpsys', 'activity', 'activities')
    resumed = next((l for l in active.splitlines() if 'mResumedActivity:' in l), '')
    if 'com.pipi.kids/.' not in resumed:
        raise RuntimeError('Another app owns the foreground; no key was sent: ' + resumed.strip())
    run('shell', 'input', 'keyevent', *(['--longpress'] if long else []), str(code))


def wait_for(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    value = snapshot()
    while not predicate(*value) and time.monotonic() < deadline:
        time.sleep(.2)
        value = snapshot()
    if not predicate(*value):
        raise AssertionError('TV did not reach expected state: ' + str(value[1:]))
    return value


def check(name, condition, evidence=None):
    checks.append({'check': name, 'passed': bool(condition), 'evidence': evidence})
    (OUT / 'tv-progress.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
    if not condition:
        raise AssertionError(name + ': ' + str(evidence))
    print('PASS:', name, flush=True)


def picture(name):
    (OUT / name).write_bytes(subprocess.check_output(ADB + ['exec-out', 'screencap', '-p'], timeout=20))


def field(player, name):
    return int(re.search(r'\b' + name + r'=(\d+)', player).group(1))


def open_drawer():
    key(82)
    wait_for(lambda s, p, f, h: 'menu=true' in p and '选集' in f)
    key(23)
    return wait_for(lambda s, p, f, h: 'drawer=true' in p and f.startswith('选集 第 '))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    run('shell', 'am', 'start', '-n', 'com.pipi.kids/.MainActivity')
    for _ in range(8):
        existing = snapshot()
        if not existing[1] and existing[3].startswith('entry:'):
            break
        key(4)
    before = wait_for(lambda s, p, f, h: h.startswith('entry:'))[0]
    check('existing allowance permits the smoke test', before['usage']['sessionMs'] < before['settings']['sessionMinutes'] * 60000
          and not before['usage']['restUntil'], before['usage'])
    key(23)
    first = wait_for(lambda s, p, f, h: 'ready=true' in p and 'playing=true' in p)
    check('series opens immersive playback', all(v in first[1] for v in ['menu=false', 'hud=false', 'drawer=false']), first[1])
    key(23)
    paused = wait_for(lambda s, p, f, h: 'playing=false' in p and 'hud=true' in p)
    check('OK pauses once and shows only progress', 'menu=false' in paused[1] and paused[2] == '播放器', paused[1:3])
    picture('05-tv-pause-hud.png')
    key(23)
    resumed = wait_for(lambda s, p, f, h: 'playing=true' in p)
    check('OK resumes once without opening menu', 'menu=false' in resumed[1] and 'hud=true' in resumed[1], resumed[1])
    key(23, long=True)
    paused = wait_for(lambda s, p, f, h: 'playing=false' in p)
    check('held OK does not toggle repeatedly', 'menu=false' in paused[1], paused[1])
    old_position = field(paused[1], 'position')
    key(22)
    sought = wait_for(lambda s, p, f, h: field(p, 'position') >= old_position + 8000)
    check('Right seeks ten seconds while staying paused', 'playing=false' in sought[1] and 'menu=false' in sought[1], sought[1])
    key(82)
    menu = wait_for(lambda s, p, f, h: 'menu=true' in p and f.startswith('选集'))
    picture('06-tv-compact-menu.png')
    check('Menu focuses Select episode', menu[2].startswith('选集'), menu[2])
    key(23)
    drawer = wait_for(lambda s, p, f, h: 'drawer=true' in p)
    current = int(re.search(r'episode=(\d+)/', drawer[1]).group(1))
    check('drawer focuses current episode', drawer[2] == f'选集 第 {current} 集', drawer[1:3])
    time.sleep(6)
    after_browsing = snapshot()
    check('drawer does not time out during browsing', 'drawer=true' in after_browsing[1], after_browsing[1:])
    picture('07-tv-episode-drawer.png')
    for _ in range(current - 1):
        key(19)
    check('Up navigates to episode one', snapshot()[2] == '选集 第 1 集', snapshot()[2])
    if current == 1:
        key(20)
        key(23)
        wait_for(lambda s, p, f, h: 'episode=2/' in p and 'playing=true' in p)
        open_drawer()
        key(19)
    key(23)
    first_episode = wait_for(lambda s, p, f, h: 'episode=1/' in p and 'playing=true' in p)
    check('arbitrary selection starts from beginning and closes overlays', field(first_episode[1], 'position') < 5000 and 'hud=false' in first_episode[1], first_episode[1])
    open_drawer()
    key(20)
    selection = snapshot()
    check('Down previews next episode without starting it', selection[2] == '选集 第 2 集' and 'episode=1/' in selection[1], selection[1:3])
    picture('08-tv-next-episode-preview.png')
    key(23)
    second = wait_for(lambda s, p, f, h: 'episode=2/' in p and 'playing=true' in p)
    check('one OK starts chosen next episode', 'hud=false' in second[1] and field(second[1], 'position') < 5000, second[1])
    check('switching preserves session usage', second[0]['usage']['sessionMs'] >= first[0]['usage']['sessionMs'] and second[0]['usage']['usedMs'] >= first[0]['usage']['usedMs'], second[0]['usage'])
    open_drawer()
    key(4)
    restored = wait_for(lambda s, p, f, h: 'drawer=false' in p and 'menu=true' in p)
    check('Back restores Select episode focus', restored[2].startswith('选集'), restored[2])
    key(4)
    check('Back closes menu first', 'hud=false' in snapshot()[1])
    key(4)
    wait_for(lambda s, p, f, h: not p and h.startswith('file:'))
    key(4)
    final = wait_for(lambda s, p, f, h: h.startswith('entry:'))[0]
    check('parent settings are unchanged', final['settings'] == before['settings'], final['settings'])
    def config(entries):
        return [{k: v for k, v in e.items() if k not in ('lastPlayedPath', 'lastPlayedAt')} for e in entries]
    check('series paths and descriptions are unchanged', config(before['entries']) == config(final['entries']))
    apk = run('shell', 'pm', 'path', 'com.pipi.kids').strip().split('package:', 1)[1]
    installed_hash = run('shell', shlex.join(['sha256sum', apk])).split()[0]
    check('installed APK matches verified build', installed_hash == hashlib.sha256((ROOT / 'outputs/PIPI-KIDS-0.1.0-dev.apk').read_bytes()).hexdigest(), installed_hash)
    report = {'checkedAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
              'device': '192.168.1.5:5555', 'checks': checks, 'pinReadOrReset': False, 'parentSettingsChanged': False,
              'restBypassed': False, 'installedApkSha256': installed_hash, 'beforeUsage': before['usage'], 'afterUsage': final['usage']}
    (OUT / 'tv-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('TV player checks completed.', flush=True)


if __name__ == '__main__':
    main()
