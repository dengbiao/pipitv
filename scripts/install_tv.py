#!/usr/bin/env python3
"""Install only the PIPI KIDS app after an authorized ADB connection exists."""
from pathlib import Path
import argparse
import datetime
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', default='192.168.1.5:5555')
    args = parser.parse_args()
    adb = TOOLS / 'platform-tools/adb'
    apk = ROOT / 'outputs/PIPI-KIDS-0.1.0-dev.apk'
    if not adb.exists() or not apk.exists(): raise SystemExit('ADB or APK missing; build the app first.')
    def run(*command, timeout=15):
        result = subprocess.run([str(adb), '-s', args.device, *command], capture_output=True, text=True, timeout=timeout)
        if result.returncode: raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return result.stdout.strip()
    connection = subprocess.run([str(adb), 'connect', args.device], capture_output=True, text=True, timeout=10)
    state = subprocess.run([str(adb), '-s', args.device, 'get-state'], capture_output=True, text=True, timeout=5)
    if state.returncode or state.stdout.strip() != 'device':
        raise SystemExit('电视尚未建立 ADB 安装连接：' + (connection.stdout + connection.stderr + state.stderr).strip())
    snapshot = {'device': args.device, 'checkedAt': datetime.datetime.now().astimezone().isoformat()}
    for key, command in {
        'manufacturer': ['shell', 'getprop', 'ro.product.manufacturer'], 'model': ['shell', 'getprop', 'ro.product.model'],
        'android': ['shell', 'getprop', 'ro.build.version.release'], 'sdk': ['shell', 'getprop', 'ro.build.version.sdk'],
        'originalHome': ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'],
    }.items():
        try: snapshot[key] = run(*command)
        except Exception as error: snapshot[key] = {'error': str(error)}
    (ROOT / 'outputs/tv-before-install.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    print(run('install', '-r', '--no-incremental', str(apk), timeout=120))
    print(run('shell', 'am', 'start', '-n', 'com.pipi.kids/.MainActivity'))
    result = run('shell', 'dumpsys', 'activity', 'activities')
    resumed = [line.strip() for line in result.splitlines() if ('ResumedActivity' in line or 'mFocusedActivity' in line)]
    report = {'installed': True, 'foregroundEvidence': resumed, 'defaultHomeChanged': False, 'device': args.device}
    (ROOT / 'outputs/tv-install-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    picture = subprocess.run([str(adb), '-s', args.device, 'exec-out', 'screencap', '-p'], capture_output=True, timeout=15)
    if picture.returncode == 0 and picture.stdout.startswith(b'\x89PNG'):
        (ROOT / 'outputs/tv-installed.png').write_bytes(picture.stdout)
    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__': main()
