import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBACK_MODES, MODE_LABELS, freshSeries, storedPlaybackMode, MODE_DEFAULT_VERSION, selectPlayback, startPlayback, progressPlayback, completePlayback, localDay } from '../src/playback.js';
const files = ['/series/01.mp4', '/series/02.mp4', '/series/03.mp4'];
test('new and previous-default series use spaced playback; subsequent explicit choices persist', () => {
  assert.deepEqual(PLAYBACK_MODES.map(mode => MODE_LABELS[mode]), ['记忆播放', '顺序播放', '随机播放']);
  assert.equal(freshSeries().mode, 'spaced');
  assert.equal(storedPlaybackMode('sequential'), 'spaced');
  assert.equal(storedPlaybackMode('sequential', MODE_DEFAULT_VERSION), 'sequential');
  assert.equal(storedPlaybackMode('spaced', MODE_DEFAULT_VERSION), 'spaced');
  assert.equal(storedPlaybackMode('random', MODE_DEFAULT_VERSION), 'random');
  assert.equal(storedPlaybackMode('unknown', MODE_DEFAULT_VERSION), 'spaced');
});
test('random playback can select every other episode, excludes the last completed item, and ignores review priority', () => {
  const s = freshSeries(); s.mode = 'random';
  assert.equal(selectPlayback(files, s, 40, false, () => 0).path, files[0]);
  assert.equal(selectPlayback(files, s, 40, false, () => 0.999).path, files[2]);
  for (const previous of files) {
    s.lastPath = previous;
    const candidates = files.filter(path => path !== previous);
    assert.equal(selectPlayback(files, s, 40, false, () => 0).path, candidates[0]);
    assert.equal(selectPlayback(files, s, 40, false, () => 0.999).path, candidates[1]);
  }
  completePlayback(s, files[0], 39);
  completePlayback(s, files[1], 40);
  const plan = selectPlayback(files, s, 40, false, () => 0.999);
  assert.equal(plan.reason, 'random'); assert.equal(plan.path, files[2]); assert.equal(plan.dueCount, 1);
});
test('random playback resumes first, stays series-scoped, and handles missing, single and empty queues', () => {
  const s = freshSeries(); s.mode = 'random';
  startPlayback(s, files[1]); progressPlayback(s, files[1], 25000, 60000);
  assert.equal(selectPlayback(files, s, 40, false, () => { throw new Error('Resume must not draw a random item'); }).path, files[1]);
  assert.equal(s.items[files[1]].positionMs, 25000);
  const otherFiles = ['/other/01.mp4', '/other/sub/02.mp3'];
  assert.equal(selectPlayback(otherFiles, s, 40, false, () => 0.999).path, otherFiles[1]);
  completePlayback(s, files[1], 40);
  assert.equal(selectPlayback([files[1]], s, 40, false, () => 0.999).path, files[1]);
  assert.equal(selectPlayback([], s, 40, false).reason, 'empty');
});
test('random playback continues after all files complete and preserves same-day review stages', () => {
  const s = freshSeries(); s.mode = 'random';
  for (const path of files) completePlayback(s, path, 40);
  for (let n = 0; n < 8; n++) {
    const plan = selectPlayback(files, s, 40, false, () => n % 2 ? 0.999 : 0);
    assert.equal(plan.reason, 'random'); assert.notEqual(plan.path, s.lastPath);
    completePlayback(s, plan.path, 40);
  }
  assert.ok(Object.values(s.items).every(item => item.stage === 0 && item.dueDay === 41));
  s.mode = 'spaced';
  assert.equal(selectPlayback(files, s, 41, false).reason, 'review');
});
test('each random round plays every item exactly once, survives restart, and reshuffles only after all complete', () => {
  let s = freshSeries(); s.mode = 'random';
  let last = '';
  for (let round = 0; round < 4; round++) {
    const seen = new Set();
    for (let n = 0; n < files.length; n++) {
      const plan = selectPlayback(files, s, 40, false, () => n % 2 ? 0.999 : 0);
      assert.equal(seen.has(plan.path), false); assert.notEqual(plan.path, last);
      const completed = [...s.randomPlayed];
      startPlayback(s, plan.path); progressPlayback(s, plan.path, 1000, 60000);
      assert.deepEqual(s.randomPlayed, completed); // Starting and pausing never consume an episode.
      s = JSON.parse(JSON.stringify(s));
      assert.equal(selectPlayback(files, s, 40, false, () => { throw new Error('Resume must win'); }).path, plan.path);
      completePlayback(s, plan.path, 40); seen.add(plan.path); last = plan.path;
      s = JSON.parse(JSON.stringify(s));
    }
    assert.deepEqual([...seen].sort(), files);
    assert.equal(s.randomPlayed.length, files.length);
  }
});
test('random rounds adapt to added/deleted files and survive mode changes independently of review history', () => {
  const s = freshSeries(); s.mode = 'random';
  completePlayback(s, files[0], 40); completePlayback(s, files[1], 40);
  s.mode = 'sequential'; completePlayback(s, files[2], 40);
  assert.deepEqual(s.randomPlayed, files.slice(0, 2));
  s.mode = 'random';
  const added = '/series/sub/new.mp3', changed = [files[1], files[2], added];
  assert.equal(selectPlayback(changed, s, 40, false, () => 0).path, added); // The previous manual episode is avoided if another candidate exists.
  completePlayback(s, added, 40);
  assert.equal(selectPlayback(changed, s, 40, false, () => 0).path, files[2]);
  assert.equal(s.randomPlayed.includes(files[0]), false);
  completePlayback(s, files[2], 40);
  assert.equal(selectPlayback(changed, s, 40, false, () => 0).path, files[1]);
  const other = freshSeries('/other'); other.mode = 'random';
  assert.deepEqual(other.randomPlayed, []);
});
test('unfinished playback wins over reviews and survives mode changes', () => {
  const s = freshSeries();
  startPlayback(s, files[0]); progressPlayback(s, files[0], 25000, 60000); s.mode = 'spaced';
  assert.equal(selectPlayback(files, s, 11).reason, 'resume');
  assert.equal(s.items[files[0]].positionMs, 25000); assert.equal(s.items[files[0]].completions, 0);
});
test('review intervals grow after completed due reviews, with no same-day advancement or catch-up burst', () => {
  const s = freshSeries(); s.mode = 'spaced';
  completePlayback(s, files[0], 11); assert.equal(s.items[files[0]].dueDay, 12);
  assert.equal(selectPlayback(files, s, 12).reason, 'review');
  completePlayback(s, files[0], 12); assert.equal(s.items[files[0]].dueDay, 15);
  completePlayback(s, files[0], 12); assert.equal(s.items[files[0]].stage, 1);
  completePlayback(s, files[0], 20); assert.equal(s.items[files[0]].dueDay, 27);
  for (let n = 0; n < 5; n++) completePlayback(s, files[0], s.items[files[0]].dueDay);
  assert.equal(s.items[files[0]].stage, 4);
  assert.equal(s.items[files[0]].dueDay - s.items[files[0]].lastDay, 30);
});
test('memory playback continues past two new items and repeats until the parent deadline; due reviews come first', () => {
  const s = freshSeries(); s.mode = 'spaced';
  completePlayback(s, files[0], 40); completePlayback(s, files[1], 40);
  assert.equal(selectPlayback(files, s, 40, false).path, files[2]);
  completePlayback(s, files[2], 40);
  assert.equal(selectPlayback(files, s, 40, false).reason, 'repeat');
  assert.equal(selectPlayback(files, s, 40, false).path, files[0]);
  completePlayback(s, files[0], 40);
  assert.equal(selectPlayback(files, s, 40, false).path, files[1]);
  assert.equal(s.items[files[0]].stage, 0);
  assert.equal(s.items[files[0]].dueDay, 41);
  assert.equal(selectPlayback(files, s, 41).path, files[0]);
  completePlayback(s, files[0], 41); completePlayback(s, files[1], 41);
  assert.equal(selectPlayback(files, s, 41).path, files[2]);
});
test('a one-item memory series can replay without losing completion or review history', () => {
  const s = freshSeries();
  completePlayback(s, files[0], 40);
  assert.equal(selectPlayback([files[0]], s, 40, false).path, files[0]);
  assert.equal(selectPlayback([files[0]], s, 40, false).reason, 'repeat');
});
test('series scope excludes missing media and preserves independent progress', () => {
  const s = freshSeries(); s.mode = 'spaced'; startPlayback(s, files[0]);
  const other = freshSeries('/other'); other.mode = 'spaced';
  assert.equal(selectPlayback(['/other/01.mp4'], other, 42).path, '/other/01.mp4');
  assert.equal(Object.keys(other.items).length, 0);
  assert.equal(selectPlayback(['/other/01.mp4'], s, 42).reason, 'new');
  assert.equal(selectPlayback([], s, 42).reason, 'empty');
});
test('sequential auto-play stops at the end, explicit re-entry can restart, completion cannot be undone by late progress', () => {
  const s = freshSeries(); s.mode = 'sequential';
  for (const path of files) completePlayback(s, path, 50);
  assert.equal(selectPlayback(files, s, 50, false).reason, 'complete');
  assert.equal(selectPlayback(files, s, 50).path, files[0]);
  progressPlayback(s, files[2], 50000, 60000); assert.equal(s.items[files[2]].positionMs, 0);
});
test('calendar dates change at local midnight', () => {
  const date = new Date(2026, 0, 1, 23, 59, 59);
  assert.equal(localDay(+date + 1000), localDay(+date) + 1);
});
test('the browser bridge persists all three per-series choices across restart without altering playback history', async () => {
  const data = new Map(), first = freshSeries('/series'), other = freshSeries('/other');
  startPlayback(first, files[0]); progressPlayback(first, files[0], 25000, 60000);
  globalThis.window = {}; globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  localStorage.setItem('pipikids-v1', JSON.stringify({
    entries: [{ id: 'first', path: '/series', kind: 'folder', title: 'First' }, { id: 'other', path: '/other', kind: 'folder', title: 'Other' }],
    playback: { first, other }, settings: { startHour: 0, endHour: 24 },
  }));
  const { call } = await import('../src/bridge.js?three-modes');
  for (const mode of PLAYBACK_MODES) {
    await call('setPlaybackMode', { entryId: 'first', mode });
    const restarted = await import(`../src/bridge.js?three-modes-restart-${mode}`);
    const snapshot = await restarted.call('getState');
    assert.equal(snapshot.playback.first.mode, mode); assert.equal(snapshot.playback.other.mode, 'spaced');
    assert.deepEqual(JSON.parse(data.get('pipikids-v1')).playback.first.items, first.items);
    assert.equal(snapshot.playback.first.resumeMs, 25000);
  }
  await assert.rejects(call('setPlaybackMode', { entryId: 'first', mode: 'invalid' }), /有效的播放模式/);
  await call('completePlayback', { entryId: 'first', path: files[0] });
  await call('setPlaybackMode', { entryId: 'first', mode: 'sequential' });
  await call('setPlaybackMode', { entryId: 'first', mode: 'random' });
  const restarted = await import('../src/bridge.js?random-round-restart');
  await restarted.call('getState');
  const saved = JSON.parse(data.get('pipikids-v1'));
  assert.deepEqual(saved.playback.first.randomPlayed, [files[0]]);
  assert.deepEqual(saved.playback.other.randomPlayed, []);
});
