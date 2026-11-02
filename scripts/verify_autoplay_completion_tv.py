#!/usr/bin/env python3
"""Natural-end autoplay regression on the TV in a disposable, isolated package."""
from pathlib import Path
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/qa/autoplay-black-screen'
ANDROID_BUILD = ROOT / 'android/build'
TOOLS = Path.home() / '.cache/pipitv-tools'
JDK = TOOLS / 'amazon-corretto-17.jdk/Contents/Home'
BT = TOOLS / 'sdk/android-15'
PLATFORM = TOOLS / 'sdk/android-35/android.jar'
ADB = [str(TOOLS / 'platform-tools/adb'), '-s', '192.168.1.5:5555']
PACKAGE = 'com.pipi.kids.autoplayqa'
checks = []


def command(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)


def adb(*args):
    return subprocess.check_output(ADB + list(args), text=True, timeout=30).strip()


def dump():
    return adb('shell', 'dumpsys', 'activity', PACKAGE)


def capture(name):
    (OUT / (name + '.png')).write_bytes(subprocess.check_output(ADB + ['exec-out', 'screencap', '-p'], timeout=20))
    (OUT / (name + '.txt')).write_text(dump())


def check(name, condition, evidence=None):
    checks.append({'check': name, 'passed': bool(condition), 'evidence': evidence})
    (OUT / 'native-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
    if not condition:
        raise AssertionError(name + ': ' + str(evidence))
    print('PASS:', name, flush=True)


def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    text = dump()
    while not predicate(text) and time.monotonic() < deadline:
        time.sleep(.15)
        text = dump()
    if not predicate(text):
        raise AssertionError('Player did not reach expected state: ' + text[-2200:])
    return text


def qa_state(text):
    return json.loads(next(line.split('PIPI_AUTOPLAY_QA=', 1)[1] for line in text.splitlines() if 'PIPI_AUTOPLAY_QA=' in line))


def build_fixture():
    build = OUT / 'native-fixture'
    if build.exists(): shutil.rmtree(build)
    shutil.copytree(ANDROID_BUILD / 'classes', build / 'classes')
    (build / 'dex').mkdir()
    (build / 'assets').mkdir()
    shutil.copy2(ROOT / 'outputs/qa/timer-test.mp4', build / 'assets/sample.mp4')
    android = '{http://schemas.android.com/apk/res/android}'
    ET.register_namespace('android', android[1:-1])
    manifest = ET.parse(ROOT / 'android/AndroidManifest.xml')
    manifest.getroot().set('package', PACKAGE)
    app = manifest.getroot().find('application'); app.set(android + 'label', 'PIPI 续播回归验证')
    for activity in app.findall('activity'):
        activity.set(android + 'name', 'com.pipi.kids' + activity.get(android + 'name'))
        for intent in activity.findall('intent-filter'): activity.remove(intent)
    ET.SubElement(app, 'activity', {android + 'name': 'com.pipi.kids.AutoplayQaActivity', android + 'exported': 'true'})
    manifest.write(build / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    source = build / 'AutoplayQaActivity.java'
    source.write_text('''package com.pipi.kids;
import android.app.Activity; import android.os.Bundle; import android.content.Intent;
import android.media.*; import android.widget.TextView;
import java.io.*; import java.nio.ByteBuffer; import org.json.*;
public final class AutoplayQaActivity extends Activity {
  private String mode; private int result; private Guard guard;
  @Override public void onCreate(Bundle saved) { super.onCreate(saved); try {
    mode = getIntent().getStringExtra("mode");
    if (getIntent().getBooleanExtra("resume", false)) {
      guard = Guard.get(this); JSONObject entry = guard.entry("autoplay-fixture");
      JSONObject plan = PlaybackStore.get(this).plan(entry, new Storage(this), false);
      startActivityForResult(new Intent(this,MediaActivity.class).putExtra("entryId","autoplay-fixture").putExtra("path",plan.getString("path")).putExtra("title",plan.getString("name")),1);
      return;
    }
    File dir = new File(getFilesDir(), "fixture"); dir.mkdirs(); File sample = new File(getFilesDir(), "sample.mp4");
    try (InputStream in = getAssets().open("sample.mp4"); FileOutputStream out = new FileOutputStream(sample)) {
      byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) > 0) out.write(buffer,0,count);
    }
    for (File old : dir.listFiles()) old.delete();
    File clip = new File(dir, "01.mp4");
    MediaExtractor extractor = new MediaExtractor(); extractor.setDataSource(sample.getPath());
    int track = -1; for (int i=0;i<extractor.getTrackCount();i++) if (extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME).startsWith("video/")) { track=i; break; }
    if (track < 0) throw new Exception("Missing fixture video track");
    extractor.selectTrack(track);
    MediaMuxer muxer = new MediaMuxer(clip.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
    int output = muxer.addTrack(extractor.getTrackFormat(track)); muxer.start();
    ByteBuffer buffer = ByteBuffer.allocate(4*1024*1024); MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    while (extractor.getSampleTime() >= 0 && extractor.getSampleTime() < 3000000) {
      buffer.clear(); int size=extractor.readSampleData(buffer,0); if (size<0) break;
      info.set(0,size,extractor.getSampleTime(),extractor.getSampleFlags()); muxer.writeSampleData(output,buffer,info); extractor.advance();
    }
    muxer.stop(); muxer.release(); extractor.release();
    int clips = "single".equals(mode) || "random-single".equals(mode) ? 1 : 3;
    for (int i=2;i<=clips;i++) try (InputStream in=new FileInputStream(clip); FileOutputStream out=new FileOutputStream(new File(dir,String.format(java.util.Locale.ROOT,"%02d.mp4",i)))) {
      byte[] bytes=new byte[8192]; int n; while ((n=in.read(bytes))>0) out.write(bytes,0,n);
    }
    getSharedPreferences("pipikids-playback",MODE_PRIVATE).edit().clear().commit();
    getSharedPreferences("pipikids-playback-stats",MODE_PRIVATE).edit().clear().commit();
    guard=Guard.get(this);
    JSONObject entry=new JSONObject().put("id","autoplay-fixture").put("title","续播验证").put("cover","animals").put("kind","folder").put("path",dir.getCanonicalPath());
    guard.initEntries(new JSONArray().put(entry));
    guard.policy.startHour=0; guard.policy.endHour=24; guard.policy.dailyMinutes=180; guard.policy.sessionMinutes=60;
    guard.policy.usedMs=0; guard.policy.sessionMs=0; guard.policy.restUntil=0; guard.policy.learning=false;
    if (mode.endsWith("session-limit")) { guard.policy.sessionMinutes=1; guard.policy.usedMs=guard.policy.sessionMs=49000; }
    if (mode.endsWith("daily-limit")) guard.policy.usedMs=180*60000-11000;
    guard.tick();
    PlaybackStore.get(this).setMode(entry, "sequential".equals(mode) ? PlaybackPlanner.SEQUENTIAL : mode.startsWith("random") ? PlaybackPlanner.RANDOM : PlaybackPlanner.SPACED);
    startActivityForResult(new Intent(this,MediaActivity.class).putExtra("entryId","autoplay-fixture").putExtra("path",clip.getCanonicalPath()).putExtra("title","01.mp4"),1);
  } catch(Exception e) { throw new RuntimeException(e); } }
  @Override protected void onActivityResult(int request,int code,Intent data) { super.onActivityResult(request,code,data); result=code; TextView label=new TextView(this); label.setText(code==RESULT_FIRST_USER ? "限时已停止" : "播放已关闭"); label.setTextSize(32); setContentView(label); }
  @Override public void dump(String prefix,FileDescriptor fd,PrintWriter writer,String[] args) { super.dump(prefix,fd,writer,args); try {
    writer.println(prefix+"PIPI_AUTOPLAY_QA="+new JSONObject().put("mode",mode).put("result",result).put("access",guard.access()).put("usage",guard.usage()).put("playback",PlaybackStore.get(this).dump(guard.entries())));
  } catch(Exception e) { throw new RuntimeException(e); } }
}
''')
    command(JDK/'bin/javac','-encoding','UTF-8','-source','8','-target','8','-classpath',str(PLATFORM)+os.pathsep+str(build/'classes'),'-d',build/'classes',source)
    command(JDK/'bin/jar','cf',build/'classes.jar','-C',build/'classes','.')
    command(JDK/'bin/java','-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--lib',PLATFORM,'--min-api','21','--output',build/'dex',build/'classes.jar')
    command(BT/'aapt2','link','-o',build/'unsigned.apk','-I',PLATFORM,'--manifest',build/'AndroidManifest.xml','-A',ANDROID_BUILD/'assets','-A',build/'assets','-0','m4a',ANDROID_BUILD/'resources.zip')
    with zipfile.ZipFile(build/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as apk:
        for dex in (build/'dex').glob('*.dex'): apk.write(dex,dex.name)
    command(BT/'zipalign','-f','4',build/'unsigned.apk',build/'aligned.apk')
    output=build/'autoplay-qa.apk'
    command(JDK/'bin/java','-jar',BT/'lib/apksigner.jar','sign','--ks',TOOLS/'pipikids-development.keystore','--ks-key-alias','pipikids-dev','--ks-pass','pass:android','--key-pass','pass:android','--out',output,build/'aligned.apk')
    return output


def run_case(mode):
    adb('shell','am','force-stop',PACKAGE)
    adb('shell','am','start','-n',PACKAGE+'/com.pipi.kids.AutoplayQaActivity','--es','mode',mode)
    wait_for(lambda text: 'ready=true' in text and 'playing=true' in text)
    if mode.startswith('random'):
        state=qa_state(dump())
        check(mode+': random mode survives saving and reloading the series', state['playback']['autoplay-fixture']['mode']=='random')
    if mode == 'sequential':
        wait_for(lambda text: 'completed=true' in text and 'endCard=true' in text, timeout=20)
        time.sleep(6)
        text=dump(); capture('sequential-finished')
        check('sequential completion keeps a visible end card and controls beyond five seconds', 'endCard=true' in text and 'menu=true' in text)
        return
    if mode.endswith('-limit'):
        text=wait_for(lambda text: 'PIPI_PLAYER ' not in text and qa_state(text)['result']==1, timeout=20)
        state=qa_state(text); capture(mode)
        check(mode+': continuous playback stops at the parent deadline', bool(state['access']['reason']), state['access'])
        completed=sum(item['completions'] for item in state['playback']['autoplay-fixture']['items'].values())
        check(mode+': multiple natural ends occurred before the deadline', completed >= 2, completed)
        return
    round_trace=[]; previous_counts={}
    def observe_rounds(text):
        try:
            items=qa_state(text)['playback']['autoplay-fixture']['items']
            counts={path:item['completions'] for path,item in items.items()}
            for path,count in counts.items():
                round_trace.extend([path] * (count-previous_counts.get(path,0)))
            previous_counts.update(counts)
        except (StopIteration,KeyError): pass
    if mode == 'random':
        def first_two(text):
            observe_rounds(text)
            return len(round_trace)>=2 and 'playing=true' in text
        text=wait_for(first_two,timeout=15)
        saved_round=qa_state(text)['playback']['autoplay-fixture']['randomPlayed']
        check('random: two natural ends consume two different items', len(saved_round)==2 and len(set(round_trace[:2]))==2, saved_round)
        adb('shell','am','force-stop',PACKAGE)
        adb('shell','am','start','-n',PACKAGE+'/com.pipi.kids.AutoplayQaActivity','--es','mode',mode,'--ez','resume','true')
        text=wait_for(lambda text: 'ready=true' in text and 'playing=true' in text)
        check('random: process restart preserves the unfinished round', qa_state(text)['playback']['autoplay-fixture']['randomPlayed']==saved_round, saved_round)
    target=6 if mode=='random' else 3 if mode.endswith('single') else 5
    def progressed(text):
        if mode=='random': observe_rounds(text)
        try: return sum(item['completions'] for item in qa_state(text)['playback']['autoplay-fixture']['items'].values()) >= target and 'playing=true' in text
        except (StopIteration,KeyError): return False
    text=wait_for(progressed, timeout=35); state=qa_state(text); capture(mode+'-continued')
    check(mode+': natural completion continues past the old two-item stop', 'completed=false' in text and 'endCard=false' in text, text.split('PIPI_PLAYER ',1)[-1].split('\n')[0])
    check(mode+': same-day repeats keep the review stage', all(item['stage']==0 for item in state['playback']['autoplay-fixture']['items'].values()))
    if mode=='random':
        check('random: every episode completes once in each of two full rounds', len(round_trace)>=6 and len(set(round_trace[:3]))==3 and set(round_trace[:3])==set(round_trace[3:6]) and len(set(round_trace[3:6]))==3, round_trace[:6])
        check('random: a new round avoids immediately repeating the previous final episode', round_trace[2]!=round_trace[3])


def main():
    global OUT, ANDROID_BUILD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--build-dir', type=Path, default=ANDROID_BUILD)
    parser.add_argument('--modes', nargs='+', choices=['memory','single','session-limit','daily-limit','sequential','random','random-single','random-session-limit','random-daily-limit'], default=['memory','single','session-limit','daily-limit','sequential'])
    args = parser.parse_args(); OUT = args.output; ANDROID_BUILD = args.build_dir
    OUT.mkdir(parents=True,exist_ok=True)
    try:
        apk=build_fixture(); adb('install','-r','--no-incremental',str(apk))
        for mode in args.modes: run_case(mode)
        (OUT/'native-verification.json').write_text(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'checks':checks,'method':'Natural end events on real Hisense TV, three-second video clips; no seeks.','productionPinOrSettingsChanged':False},ensure_ascii=False,indent=2)+'\n')
    finally:
        adb('shell','am','force-stop',PACKAGE)
        adb('shell','am','start','-n','com.pipi.kids/.MainActivity')


if __name__=='__main__': main()
