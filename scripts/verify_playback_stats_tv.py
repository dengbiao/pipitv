#!/usr/bin/env python3
"""Playback-statistics QA in a separate TV package; never reads or changes the real PIN."""
from pathlib import Path
import json, os, shutil, subprocess, time, xml.etree.ElementTree as ET, zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/playback-stats'
TOOLS = Path.home() / '.cache/pipitv-tools'
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
BT = TOOLS / 'sdk/android-15'
PLATFORM = TOOLS / 'sdk/android-35/android.jar'
ADB = [str(TOOLS / 'platform-tools/adb'), '-s', '192.168.1.5:5555']
PACKAGE = 'com.pipi.kids.statsqa'
checks = []

def command(*args):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)

def adb(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=30).strip()

def dump():
    return adb('shell', 'dumpsys', 'activity', PACKAGE)

def statistics():
    return json.loads(next(line.split('PIPI_STATISTICS=', 1)[1] for line in dump().splitlines() if 'PIPI_STATISTICS=' in line))

def check(name, condition):
    if not condition: raise AssertionError(name)
    checks.append(name); print('PASS:', name, flush=True)
    (OUT / 'tv-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')

def wait_for(name, predicate, timeout=12):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate(): return
        time.sleep(.15)
    raise AssertionError(name)

def key(code):
    resumed = next(line for line in adb('shell', 'dumpsys', 'activity', 'activities').splitlines() if 'mResumedActivity:' in line)
    if PACKAGE + '/' not in resumed: raise RuntimeError('QA app no longer owns TV foreground')
    adb('shell', 'input', 'keyevent', str(code))

def screen(name):
    (OUT / (name + '.png')).write_bytes(subprocess.check_output(ADB + ['exec-out', 'screencap', '-p'], timeout=20))

def tap_text(label):
    adb('shell', 'uiautomator', 'dump', '/sdcard/pipi-stats-qa.xml')
    raw = adb('shell', 'cat', '/sdcard/pipi-stats-qa.xml')
    (OUT / 'tv-parent.xml').write_text(raw)
    for node in ET.fromstring(raw).iter('node'):
        if node.get('text') == label or node.get('content-desc') == label:
            import re
            x1,y1,x2,y2 = map(int, re.findall(r'\d+', node.get('bounds')))
            adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)); return
    raise AssertionError('Missing control: ' + label)

def build_fixture():
    build = OUT / 'tv-fixture'; build.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'android/build/classes', build / 'classes', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'android/build/assets/web', build / 'assets/web', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'outputs/qa/timer-test.mp4', build / 'assets/test.mp4')
    (build / 'dex').mkdir(exist_ok=True)
    android = '{http://schemas.android.com/apk/res/android}'; ET.register_namespace('android', android[1:-1])
    manifest = ET.parse(ROOT / 'android/AndroidManifest.xml'); manifest.getroot().set('package', PACKAGE)
    application = manifest.getroot().find('application'); application.set(android + 'label', 'PIPI 统计验证')
    for activity in application.findall('activity'):
        activity.set(android + 'name', 'com.pipi.kids' + activity.get(android + 'name'))
        for intent in activity.findall('intent-filter'): activity.remove(intent)
    ET.SubElement(application, 'activity', {android + 'name': 'com.pipi.kids.StatsQaActivity', android + 'exported': 'true'})
    manifest.write(build / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    source = build / 'StatsQaActivity.java'
    source.write_text('''package com.pipi.kids;
import android.app.Activity; import android.os.Bundle; import android.content.Intent;
import java.io.*; import org.json.*;
public final class StatsQaActivity extends Activity {
  @Override public void onCreate(Bundle saved) { super.onCreate(saved); try {
    File dir = new File(getFilesDir(), "fixture"); dir.mkdirs();
    File file = new File(dir, "01 Hello.mp4");
    try (InputStream in = getAssets().open("test.mp4"); FileOutputStream out = new FileOutputStream(file)) {
      byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
    }
    Guard guard = Guard.get(this); PlaybackStore store = PlaybackStore.get(this);
    JSONObject en = new JSONObject().put("id", "english").put("title", "古力小超人").put("language", "en").put("cover", "animals").put("kind", "folder").put("path", dir.getCanonicalPath());
    JSONObject wow = new JSONObject(en.toString()).put("id", "wow").put("title", "WOW English").put("cover", "colors");
    JSONObject other = new JSONObject(en.toString()).put("id", "other").put("title", "其他语言系列").put("language", "other").put("cover", "songs");
    JSONArray entries = new JSONArray().put(en).put(wow).put(other); guard.initEntries(entries);
    String token = guard.unlock("2468").getString("token");
    guard.saveSettings(token, new JSONObject().put("startHour", 0).put("endHour", 24).put("dailyMinutes", 180).put("sessionMinutes", 60)); guard.leaveParent();
    for (JSONObject entry : new JSONObject[]{en,wow,other}) store.resetTime(entry);
    store.recordTime(en, "video", 3600000); store.recordTime(en, "audio", 123000);
    store.recordTime(wow, "video", 63000); store.recordTime(other, "video", 11000);
    if (store.statistics(entries).getLong("englishVideoMs") != 3663000) throw new Exception("English aggregate mismatch");
    store.start(en, file.getCanonicalPath(), new Storage(this), true); store.progress(en, file.getCanonicalPath(), 1000, 65000);
    String before = store.dump(entries).toString(); store.resetTime(en);
    if (!before.equals(store.dump(entries).toString())) throw new Exception("Reset altered playback history");
    if (store.statistics(entries).getLong("englishVideoMs") != 63000 || store.statistics(entries).getJSONObject("series").getJSONObject("other").getLong("totalMs") != 11000) throw new Exception("Reset scope mismatch");
    store.recordTime(en, "video", 3600000); store.recordTime(en, "audio", 123000);
    startActivity(new Intent(this, MainActivity.class)); finish();
  } catch (Exception e) { throw new RuntimeException(e); } }
}
''')
    command(JDK/'bin/javac','-encoding','UTF-8','-source','8','-target','8','-classpath',str(PLATFORM)+os.pathsep+str(build/'classes'),'-d',build/'classes',source)
    command(JDK/'bin/jar','cf',build/'classes.jar','-C',build/'classes','.')
    command(JDK/'bin/java','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--lib',PLATFORM,'--min-api','21','--output',build/'dex',build/'classes.jar')
    unsigned = build/'unsigned.apk'
    command(BT/'aapt2','link','-o',unsigned,'-I',PLATFORM,'--manifest',build/'AndroidManifest.xml','-A',build/'assets','-0','m4a',ROOT/'android/build/resources.zip')
    with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (build/'dex').glob('*.dex'): apk.write(dex,dex.name)
    command(BT/'zipalign','-f','4',unsigned,build/'aligned.apk')
    output=build/'stats-qa.apk'
    command(JDK/'bin/java','-jar',BT/'lib/apksigner.jar','sign','--ks',TOOLS/'pipikids-development.keystore','--ks-key-alias','pipikids-dev','--ks-pass','pass:android','--key-pass','pass:android','--out',output,build/'aligned.apk')
    return output

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    apk=build_fixture(); adb('install','-r','--no-incremental',str(apk))
    adb('shell','am','force-stop',PACKAGE)
    adb('shell','am','start','-n',PACKAGE+'/com.pipi.kids.StatsQaActivity')
    try:
        wait_for('QA home ready',lambda:'PIPI_FOCUS=entry:english' in dump())
        check('native store keeps resets isolated from resume/review and excludes other-language videos',statistics()['englishVideoMs']==3663000)
        screen('tv-qa-home')
        tap_text('进入家长管理')
        wait_for('PIN keypad',lambda:'PIPI_FOCUS=pin-1' in dump())
        for code in [22,23,20,21,23,22,22,23,20,21,23,20,22,23]: key(code)
        wait_for('parent entered',lambda:'PIPI_FOCUS=pin-' not in dump() and 'PIPI_FOCUS=进入家长管理' not in dump())
        tap_text('播放统计')
        wait_for('stats first reset target',lambda:'PIPI_FOCUS=reset-time:english' in dump())
        screen('tv-qa-parent-before')
        key(23); wait_for('cancel is default',lambda:'PIPI_FOCUS=取消' in dump())
        key(4); wait_for('cancel restores trigger',lambda:'PIPI_FOCUS=reset-time:english' in dump())
        check('Back cancels reset and keeps its selected series',statistics()['series']['english']['totalMs']==3723000)
        key(23); wait_for('reset dialog reopened',lambda:'PIPI_FOCUS=取消' in dump()); key(22); key(23)
        wait_for('reset reflected in native totals',lambda:statistics()['series']['english']['totalMs']==0)
        check('D-pad reset updates English aggregate and keeps other series',statistics()['englishVideoMs']==63000 and statistics()['series']['other']['totalMs']==11000)
        screen('tv-qa-parent-after')
        key(4); wait_for('home restored',lambda:'PIPI_FOCUS=entry:english' in dump()); key(23)
        wait_for('native video playing',lambda:'PIPI_PLAYER kind=video ready=true' in dump() and 'playing=true' in dump())
        time.sleep(3); key(23)
        wait_for('video paused',lambda:'playing=false' in dump())
        paused=statistics()['series']['english']['totalMs']; check('native actual playback accumulates seconds',2000<=paused<10000)
        time.sleep(2); check('native pause adds no watched time',statistics()['series']['english']['totalMs']==paused)
        key(4); key(4)
        wait_for('player exited',lambda:'PIPI_PLAYER kind=video' not in dump())
        adb('shell','am','force-stop',PACKAGE); adb('shell','am','start','-n',PACKAGE+'/com.pipi.kids.MainActivity')
        wait_for('restarted UI ready',lambda:'PIPI_FOCUS=entry:english' in dump())
        check('TV process restart retains cumulative seconds',statistics()['series']['english']['totalMs']==paused)
        (OUT/'tv-final-state.txt').write_text(dump()); screen('tv-qa-home-final')
    finally:
        adb('shell','am','force-stop',PACKAGE)
        adb('shell','am','start','-n','com.pipi.kids/.MainActivity')

if __name__=='__main__': main()
