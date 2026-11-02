#!/usr/bin/env python3
"""Exercise real TV deadlines/audio in an isolated app; never read or alter a PIN."""
from pathlib import Path
import datetime
import json
import os
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/rest-reminder-dreamina'
TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
SDK = TOOLS / 'sdk'
BT = SDK / 'android-15'
PLATFORM = SDK / 'android-35/android.jar'
ADB = [str(TOOLS / 'platform-tools/adb'), '-s', '192.168.1.5:5555']
PACKAGE = 'com.pipi.kids.reminderqa'
checks = []


def command(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)


def adb(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=30).strip()


def wait_for(description, reader, predicate, timeout=12):
    deadline = time.monotonic() + timeout
    value = reader()
    while not predicate(value) and time.monotonic() < deadline:
        time.sleep(.2)
        value = reader()
    if not predicate(value):
        raise AssertionError(f'{description}: {value[-1500:]}')
    checks.append(description)
    print('PASS:', description, flush=True)
    return value


def main_dump():
    return adb('shell', 'dumpsys', 'activity', PACKAGE + '/com.pipi.kids.MainActivity')


def key(code):
    active = adb('shell', 'dumpsys', 'activity', 'activities')
    resumed = next((line for line in active.splitlines() if 'mResumedActivity:' in line), '')
    if PACKAGE + '/com.pipi.kids.' not in resumed:
        raise RuntimeError('The reminder test no longer owns the TV foreground; no key was sent.')
    adb('shell', 'input', 'keyevent', str(code))


def entry_configuration(entries):
    # Playback in another session can legitimately advance history during QA.
    return [{key: value for key, value in entry.items() if key not in {'lastPlayedPath', 'lastPlayedAt'}} for entry in entries]


def build_fixture():
    build = OUT / 'build'
    build.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'android/build/classes', build / 'classes', dirs_exist_ok=True)
    (build / 'dex').mkdir(exist_ok=True)
    (build / 'assets').mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'outputs/qa/timer-test.mp4', build / 'assets/reminder-test.mp4')
    android = '{http://schemas.android.com/apk/res/android}'
    ET.register_namespace('android', android[1:-1])
    manifest = ET.parse(ROOT / 'android/AndroidManifest.xml')
    manifest.getroot().set('package', PACKAGE)
    application = manifest.getroot().find('application')
    application.set(android + 'label', 'PIPI 休息验证')
    for activity in application.findall('activity'):
        activity.set(android + 'name', 'com.pipi.kids' + activity.get(android + 'name'))
        for intent_filter in activity.findall('intent-filter'):
            activity.remove(intent_filter)
    ET.SubElement(application, 'activity', {android + 'name': 'com.pipi.kids.RestReminderQaActivity', android + 'exported': 'true'})
    manifest.write(build / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    source = build / 'RestReminderQaActivity.java'
    source.write_text('''package com.pipi.kids;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import java.io.*;
import org.json.*;
public final class RestReminderQaActivity extends Activity {
  @Override public void onCreate(Bundle saved) { super.onCreate(saved); try {
    File dir = new File(getFilesDir(), "fixture"); dir.mkdirs(); File video = new File(dir, "01.mp4");
    try (InputStream in = getAssets().open("reminder-test.mp4"); FileOutputStream out = new FileOutputStream(video)) {
      byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
    }
    Guard guard = Guard.get(this); boolean direct = "direct".equals(getIntent().getStringExtra("mode"));
    guard.initEntries(new JSONArray().put(new JSONObject().put("id", "rest-fixture").put("title", "休息提醒验证")
      .put("cover", "animals").put("path", (direct ? video : dir).getCanonicalPath()).put("kind", direct ? "video" : "folder")));
    guard.policy.startHour = 0; guard.policy.endHour = 24; guard.policy.dailyMinutes = 5;
    guard.policy.sessionMinutes = 1; guard.policy.restMinutes = 1; guard.policy.usedMs = 55000;
    guard.policy.sessionMs = 55000; guard.policy.restUntil = 0; guard.policy.learning = false; guard.tick();
    startActivity(new Intent(this, MainActivity.class)); finish();
  } catch (Exception error) { throw new RuntimeException(error); } }
}
''')
    command(JDK / 'bin/javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', str(PLATFORM) + os.pathsep + str(build / 'classes'), '-d', build / 'classes', source)
    command(JDK / 'bin/jar', 'cf', build / 'classes.jar', '-C', build / 'classes', '.')
    command(JDK / 'bin/java', '-cp', BT / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', PLATFORM, '--min-api', '21', '--output', build / 'dex', build / 'classes.jar')
    unsigned = build / 'unsigned.apk'
    command(BT / 'aapt2', 'link', '-o', unsigned, '-I', PLATFORM, '--manifest', build / 'AndroidManifest.xml', '-A', ROOT / 'android/build/assets', '-A', build / 'assets', '-0', 'm4a', ROOT / 'android/build/resources.zip')
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (build / 'dex').glob('*.dex'):
            apk.write(dex, dex.name)
    command(BT / 'zipalign', '-f', '4', unsigned, build / 'aligned.apk')
    output = build / 'rest-reminder-qa.apk'
    command(JDK / 'bin/java', '-jar', BT / 'lib/apksigner.jar', 'sign', '--ks', TOOLS / 'pipikids-development.keystore', '--ks-key-alias', 'pipikids-dev', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', output, build / 'aligned.apk')
    return output


def run_case(mode, expected):
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-n', PACKAGE + '/com.pipi.kids.RestReminderQaActivity', '--es', 'mode', mode)
    wait_for(mode + ': home is ready', main_dump, lambda text: 'PIPI_FOCUS=entry:rest-fixture' in text)
    key('23')
    # Series entries now paint their library and start the scheduled episode
    # directly. A second OK would pause that episode, rather than open a file.
    wait_for(mode + ': native fullscreen playback started', lambda: adb('shell', 'dumpsys', 'activity', 'activities'),
             lambda text: any(PACKAGE + '/com.pipi.kids.MediaActivity' in line for line in text.splitlines() if 'mResumedActivity' in line))
    wait_for(mode + ': deadline returned to rest page and played its recording once', main_dump,
             lambda text: f'PIPI_REST_AUDIO=id={expected["id"]} state=completed starts=1' in text)
    time.sleep(2)
    assert 'starts=1' in main_dump(), 'Polling replayed the reminder'
    adb('shell', 'uiautomator', 'dump', '/sdcard/pipi-rest-reminder-qa.xml')
    xml = adb('shell', 'cat', '/sdcard/pipi-rest-reminder-qa.xml')
    assert expected['text'] in xml, 'Spoken recording does not match the displayed caption'
    (OUT / (mode + '-rest.xml')).write_text(xml)
    (OUT / (mode + '-rest.png')).write_bytes(subprocess.check_output(ADB + ['exec-out', 'screencap', '-p'], timeout=20))
    (OUT / (mode + '-state.txt')).write_text(main_dump())
    if mode == 'direct':
        key('4')
        wait_for('Back dismisses the rest page', main_dump, lambda text: 'PIPI_FOCUS=entry:rest-fixture' in text)
        key('23')
        wait_for('reopening a blocked entry speaks the same daily caption', main_dump,
                 lambda text: f'PIPI_REST_AUDIO=id={expected["id"]} state=playing starts=2' in text)
        key('4')
        wait_for('leaving the page stops its audio immediately', main_dump, lambda text: 'state=stopped starts=2' in text)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    original = adb('shell', 'dumpsys', 'activity', 'com.pipi.kids/.MainActivity')
    before = json.loads(next(line.split('PIPI_STATE=', 1)[1] for line in original.splitlines() if 'PIPI_STATE=' in line))
    home = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME')
    today = datetime.date.fromisoformat(adb('shell', 'date', '+%F'))
    reminders = json.loads((ROOT / 'public/rest-reminders.json').read_text())
    expected = reminders[(today - datetime.date(2026, 11, 1)).days % len(reminders)]
    apk = build_fixture()
    try:
        print(adb('install', '-r', '--no-incremental', str(apk)), flush=True)
        for mode in ['folder', 'direct']:
            run_case(mode, expected)
        assert adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME') == home
        after_dump = adb('shell', 'dumpsys', 'activity', 'com.pipi.kids/.MainActivity')
        after = json.loads(next(line.split('PIPI_STATE=', 1)[1] for line in after_dump.splitlines() if 'PIPI_STATE=' in line))
        assert entry_configuration(before['entries']) == entry_configuration(after['entries']) and before['settings'] == after['settings']
        report = {'checkedAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(), 'device': ADB[-1],
                  'isolatedPackage': PACKAGE, 'checks': checks, 'caption': expected, 'productionEntryConfigurationAndSettingsUnchanged': True,
                  'pinReadOrReset': False, 'defaultHomeUnchanged': True, 'audioEvidence': 'native MediaPlayer reached completion on the actual TV; speaker audibility not independently recorded'}
        (OUT / 'tv-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    finally:
        adb('uninstall', PACKAGE)
        adb('shell', 'rm', '-f', '/sdcard/pipi-rest-reminder-qa.xml')
        adb('shell', 'am', 'start', '-n', 'com.pipi.kids/.MainActivity')


if __name__ == '__main__':
    main()
