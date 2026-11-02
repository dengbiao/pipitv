#!/usr/bin/env python3
"""Build an offline Android TV APK using the official JDK and Android SDK tools."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('PIPITV_TOOLS_DIR', str(Path.home() / '.cache/pipitv-tools')))
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
SDK = TOOLS / 'sdk'
BUILD_TOOLS = SDK / 'android-15'
PLATFORM = SDK / 'android-35/android.jar'
BUILD = ROOT / 'android/build'
OUTPUT = ROOT / 'outputs/PIPI-KIDS-0.1.0-dev.apk'

def run(*args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT, **kwargs)

def main():
    for path in [JDK / 'bin/java', JDK / 'bin/javac', BUILD_TOOLS / 'aapt2', PLATFORM]:
        if not path.exists():
            raise SystemExit('Missing build dependency: %s. Run python3 scripts/prepare_android.py first.' % path)
    run('npm', '--prefix', 'web', 'run', 'build')
    if BUILD.exists(): shutil.rmtree(BUILD)
    for folder in ['assets/web', 'res/drawable-nodpi', 'classes', 'dex', 'test-classes']:
        (BUILD / folder).mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'web/dist/client', BUILD / 'assets/web', dirs_exist_ok=True)
    if (ROOT / 'android/assets').is_dir():
        shutil.copytree(ROOT / 'android/assets', BUILD / 'assets', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'public/art/animals.png', BUILD / 'res/drawable-nodpi/icon.png')
    if (ROOT / 'android/res').is_dir():
        shutil.copytree(ROOT / 'android/res', BUILD / 'res', dirs_exist_ok=True)
    banner = ROOT / 'outputs/qa/home-final.png'
    if not banner.exists(): banner = ROOT / 'outputs/design/selected.png'
    run('/usr/bin/sips', '-s', 'format', 'png', '-z', '180', '320', banner, '--out', BUILD / 'res/drawable-nodpi/banner.png', stdout=subprocess.DEVNULL)
    run(BUILD_TOOLS / 'aapt2', 'compile', '--dir', BUILD / 'res', '-o', BUILD / 'resources.zip')
    unsigned = BUILD / 'unsigned.apk'
    run(BUILD_TOOLS / 'aapt2', 'link', '-o', unsigned, '-I', PLATFORM, '--manifest', ROOT / 'android/AndroidManifest.xml', '-A', BUILD / 'assets', '-0', 'm4a', BUILD / 'resources.zip')
    sources = list((ROOT / 'android/src').rglob('*.java'))
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', PLATFORM, '-d', BUILD / 'classes', *sources)
    run(JDK / 'bin/jar', 'cf', BUILD / 'classes.jar', '-C', BUILD / 'classes', '.')
    run(JDK / 'bin/java', '-cp', BUILD_TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', PLATFORM, '--min-api', '21', '--output', BUILD / 'dex', BUILD / 'classes.jar')
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (BUILD / 'dex').glob('*.dex'): apk.write(dex, dex.name)
    aligned = BUILD / 'aligned.apk'
    run(BUILD_TOOLS / 'zipalign', '-f', '4', unsigned, aligned)
    key = TOOLS / 'pipikids-development.keystore'
    if not key.exists():
        run(JDK / 'bin/keytool', '-genkeypair', '-keystore', key, '-storetype', 'JKS', '-storepass', 'android', '-keypass', 'android', '-alias', 'pipikids-dev', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=PIPI KIDS Local Development', '-noprompt')
    OUTPUT.parent.mkdir(exist_ok=True)
    signed = BUILD / 'signed.apk'
    run(JDK / 'bin/java', '-jar', BUILD_TOOLS / 'lib/apksigner.jar', 'sign', '--ks', key, '--ks-key-alias', 'pipikids-dev', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', signed, aligned)
    run(JDK / 'bin/java', '-jar', BUILD_TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', signed)
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/TimePolicy.java', ROOT / 'android/tests/TimePolicyTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'TimePolicyTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/TimePolicy.java', ROOT / 'android/src/com/pipi/kids/AppControlSession.java', ROOT / 'android/tests/AppControlTimeTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.AppControlTimeTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/FrameQuality.java', ROOT / 'android/tests/FrameQualityTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.FrameQualityTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-classpath', PLATFORM, '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/RemoteKeys.java', ROOT / 'android/tests/RemoteKeysTest.java')
    run(JDK / 'bin/java', '-cp', str(BUILD / 'test-classes') + os.pathsep + str(PLATFORM), 'com.pipi.kids.RemoteKeysTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/PinPolicy.java', ROOT / 'android/tests/PinPolicyTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.PinPolicyTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/PlaybackPlanner.java', ROOT / 'android/tests/PlaybackPlannerTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.PlaybackPlannerTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/PlaybackClock.java', ROOT / 'android/tests/PlaybackClockTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.PlaybackClockTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/PlaybackPlanner.java', ROOT / 'android/src/com/pipi/kids/GameProgress.java', ROOT / 'android/tests/GameProgressTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.GameProgressTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/MediaCatalog.java', ROOT / 'android/tests/MediaCatalogTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.MediaCatalogTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/ContentDiscovery.java', ROOT / 'android/tests/ContentDiscoveryTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.ContentDiscoveryTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/BaiduPolicy.java', ROOT / 'android/tests/BaiduPolicyTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.BaiduPolicyTest')
    run(JDK / 'bin/javac', '-encoding', 'UTF-8', '-d', BUILD / 'test-classes', ROOT / 'android/src/com/pipi/kids/BaiduPolicy.java', ROOT / 'android/src/com/pipi/kids/BaiduStream.java', ROOT / 'android/tests/BaiduStreamTest.java')
    run(JDK / 'bin/java', '-cp', BUILD / 'test-classes', 'com.pipi.kids.BaiduStreamTest')
    staging = OUTPUT.with_suffix('.apk.tmp'); shutil.copy2(signed, staging); os.replace(staging, OUTPUT)
    metadata = {'package': 'com.pipi.kids', 'version': '0.1.0', 'minAndroidApi': 21, 'targetApi': 28,
                'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), 'bytes': OUTPUT.stat().st_size,
                'signing': 'local development key; retain ~/.cache/pipitv-tools/pipikids-development.keystore for updates',
                'devicePlaybackVerified': False}
    (ROOT / 'outputs/apk-build.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print('APK ready: %s (%s bytes)' % (OUTPUT, OUTPUT.stat().st_size))

if __name__ == '__main__': main()
