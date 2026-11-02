#!/usr/bin/env python3
"""Suspend or restore the local TV's limits using a temporary signed helper."""
from pathlib import Path
import argparse
import datetime
import json
import os
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
BT = TOOLS / 'sdk/android-15'
PLATFORM = TOOLS / 'sdk/android-35/android.jar'
HELPER = 'com.pipi.kids.debuglimits'
STATE_FILE = ROOT / 'outputs/debug-time-limits-state.json'


def run(*args):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout


def read_state(adb):
    raw = run(*adb, 'shell', 'dumpsys', 'activity', 'com.pipi.kids/.MainActivity')
    return next(json.loads(line.split('PIPI_STATE=', 1)[1]) for line in raw.splitlines() if 'PIPI_STATE=' in line)


def helper_apk(build):
    for folder in ('classes', 'dex'):
        (build / folder).mkdir()
    source = build / 'Limits.java'
    source.write_text('''package com.pipi.kids.debuglimits;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
public final class Limits extends Instrumentation {
    private boolean pause;
    @Override public void onCreate(Bundle args) {
        super.onCreate(args); pause = "pause".equals(args.getString("action")); start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (!getTargetContext().getSharedPreferences("pipikids-debug", Context.MODE_PRIVATE)
                .edit().putBoolean("limitsSuspended", pause).commit())
                throw new IllegalStateException("Cannot persist debug flag");
            result.putBoolean("limitsSuspended", pause);
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("error", error.toString()); finish(Activity.RESULT_CANCELED, result);
        }
    }
}
''')
    manifest = build / 'AndroidManifest.xml'
    manifest.write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.pipi.kids.debuglimits" android:versionCode="1" android:versionName="1.0">
<uses-sdk android:minSdkVersion="21" android:targetSdkVersion="28" />
<application android:label="PIPI temporary debug limits" android:allowBackup="false" />
<instrumentation android:name="com.pipi.kids.debuglimits.Limits" android:targetPackage="com.pipi.kids" />
</manifest>''')
    run(JDK / 'bin/javac', '-source', '8', '-target', '8', '-classpath', PLATFORM, '-d', build / 'classes', source)
    run(JDK / 'bin/jar', 'cf', build / 'classes.jar', '-C', build / 'classes', '.')
    run(JDK / 'bin/java', '-cp', BT / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', PLATFORM,
        '--min-api', '21', '--output', build / 'dex', build / 'classes.jar')
    unsigned = build / 'unsigned.apk'
    run(BT / 'aapt2', 'link', '-o', unsigned, '-I', PLATFORM, '--manifest', manifest)
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        apk.write(build / 'dex/classes.dex', 'classes.dex')
    run(BT / 'zipalign', '-f', '4', unsigned, build / 'aligned.apk')
    signed = build / 'helper.apk'
    run(JDK / 'bin/java', '-jar', BT / 'lib/apksigner.jar', 'sign', '--ks', TOOLS / 'pipikids-development.keystore',
        '--ks-key-alias', 'pipikids-dev', '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
        '--out', signed, build / 'aligned.apk')
    return signed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('pause', 'restore', 'status'))
    parser.add_argument('--device', default='192.168.1.5:5555')
    args = parser.parse_args()
    adb = [str(TOOLS / 'platform-tools/adb'), '-s', args.device]
    before = read_state(adb)
    if 'limitsSuspended' not in before.get('access', {}):
        raise RuntimeError('Install the build supporting debug suspension first.')
    if args.action == 'status':
        print(json.dumps({'device': args.device, 'access': before['access'], 'settings': before['settings']}, ensure_ascii=False, indent=2))
        return
    saved = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    if saved.get('active') and saved.get('device') != args.device:
        raise RuntimeError('The saved debug session belongs to a different device.')
    if args.action == 'pause' and not saved.get('active'):
        saved = {'device': args.device, 'originalSettings': before['settings'], 'originalUsage': before['usage']}
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix='pipitv-debug-limits-') as directory:
        apk = helper_apk(Path(directory))
        installed = False
        try:
            result = run(*adb, 'install', '-r', '-t', '--no-incremental', apk)
            if 'Success' not in result:
                raise RuntimeError(result)
            installed = True
            run(*adb, 'shell', 'am', 'force-stop', 'com.pipi.kids')
            result = run(*adb, 'shell', 'am', 'instrument', '-w', '-e', 'action', args.action, HELPER + '/' + HELPER + '.Limits')
            expected = 'true' if args.action == 'pause' else 'false'
            if f'limitsSuspended={expected}' not in result or 'INSTRUMENTATION_CODE: -1' not in result:
                raise RuntimeError(result)
        finally:
            try:
                if installed:
                    if 'Success' not in run(*adb, 'uninstall', HELPER):
                        raise RuntimeError('Temporary helper removal failed.')
            finally:
                run(*adb, 'shell', 'am', 'start', '-n', 'com.pipi.kids/.MainActivity')
    for attempt in range(25):
        try:
            after = read_state(adb)
            break
        except StopIteration:
            time.sleep(.2)
    else:
        raise RuntimeError('Unable to read restarted app state.')
    assert after['access']['limitsSuspended'] == (args.action == 'pause'), after['access']
    assert after['settings'] == before['settings'], 'Parental settings changed.'
    assert after['entries'] == before['entries'], 'Entries or playback history changed.'
    assert after['usage']['usedMs'] == before['usage']['usedMs'], 'Daily usage changed.'
    assert HELPER not in run(*adb, 'shell', 'pm', 'list', 'instrumentation'), 'Temporary helper remains installed.'
    saved.update({'device': args.device, 'active': args.action == 'pause', 'lastAction': args.action,
                  'updatedAt': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
                  'currentSettings': after['settings'], 'access': after['access'], 'temporaryHelperRemoved': True})
    STATE_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(saved, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
