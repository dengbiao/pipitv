import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock, freshPlaybackStats, addPlaybackTime, playbackStatistics, playbackTimeText } from '../src/playback-stats.js';

test('actual progress counts repeat viewing; pauses, stalls and background time do not count', () => {
  const clock = new PlaybackClock();
  assert.equal(clock.sample(0, 12000, true), 0); // A resume position is not watched time.
  assert.equal(clock.sample(2000, 14000, true), 2000);
  assert.equal(clock.sample(2500, 14500, false), 500); // Flush the final part when paused.
  assert.equal(clock.sample(12500, 14500, false), 0);
  assert.equal(clock.sample(13000, 14500, true), 0);
  assert.equal(clock.sample(15000, 14500, true), 0); // Stalled decoder.
  assert.equal(clock.sample(16000, 15500, false), 1000);
  assert.equal(clock.sample(26000, 25500, false), 0); // Background media progress is excluded.
  clock.reset(27000, 0, true); // Replay starts a new interval.
  assert.equal(clock.sample(28000, 1000, true), 1000);
});

test('forward/backward seeks and old timers cannot turn a position jump into watched time', () => {
  const clock = new PlaybackClock(); clock.reset(0, 0, true);
  assert.equal(clock.sample(500, 500, false), 500);
  clock.reset(500, 90000, false); // Seeking.
  assert.equal(clock.sample(1500, 100000, false), 0);
  clock.reset(1500, 100000, true); // Seek completed.
  assert.equal(clock.sample(2500, 101000, true), 1000);
  clock.reset(2500, 1000, true);
  assert.equal(clock.sample(3500, 2000, true), 1000);
  assert.equal(clock.sample(63500, 62000, false), 5000); // A suspended timer has a bounded tail.
});

test('series totals include audio, English aggregate includes only English videos', () => {
  const en = freshPlaybackStats(), other = freshPlaybackStats();
  addPlaybackTime(en, 'video', 3000); addPlaybackTime(en, 'audio', 2000);
  addPlaybackTime(en, 'image', 5000); addPlaybackTime(en, 'pdf', 5000);
  addPlaybackTime(en, 'video', NaN); addPlaybackTime(en, 'video', -2000);
  addPlaybackTime(other, 'video', 4000);
  const entries = [{ id: 'en' }, { id: 'other', language: 'other' }, { id: 'new', language: 'en' }];
  const stats = playbackStatistics(entries, { en, other, removed: { videoMs: 90000 } });
  assert.equal(stats.series.en.totalMs, 5000); assert.equal(stats.englishVideoMs, 3000);
  assert.equal(stats.series.other.totalMs, 4000); assert.equal(stats.series.new.totalMs, 0);
  assert.deepEqual(playbackStatistics(entries, { en: freshPlaybackStats(), other }).series.other, other);
  assert.equal(playbackStatistics(entries, { en: freshPlaybackStats(), other }).englishVideoMs, 0);
});

test('duration display keeps hours, minutes and seconds without rounding up', () => {
  assert.equal(playbackTimeText(), '0 秒'); assert.equal(playbackTimeText(59999), '59 秒');
  assert.equal(playbackTimeText(61000), '1 分 1 秒'); assert.equal(playbackTimeText(3723000), '1 小时 2 分 3 秒');
});

test('bridge persists independent series totals and requires parent authorization to reset', async () => {
  const data = new Map();
  globalThis.window = {}; globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const entries = [{ id: 'en', path: '/en', kind: 'folder', language: 'en', title: 'English' },
    { id: 'other', path: '/other', kind: 'folder', language: 'other', title: 'Other' }];
  localStorage.setItem('pipikids-v1', JSON.stringify({ entries,
    playback: { en: { root: '/en', mode: 'spaced', resumePath: '/en/01.mp4', items: { '/en/01.mp4': { positionMs: 12000, completions: 1 } } } },
    settings: { startHour: 0, endHour: 24 }, usage: { day: 'invalid', usedMs: 0, sessionMs: 0 } }));
  const { call } = await import('../src/bridge.js?statistics-test');
  await call('recordPlaybackTime', { entryId: 'en', path: '/en/01.mp4', elapsedMs: 3000 });
  await call('recordPlaybackTime', { entryId: 'en', path: '/en/song.mp3', elapsedMs: 1000 });
  await call('recordPlaybackTime', { entryId: 'other', path: '/other/01.mp4', elapsedMs: 2000 });
  await assert.rejects(call('recordPlaybackTime', { entryId: 'en', path: '/other/01.mp4', elapsedMs: 2000 }));
  await assert.rejects(call('resetPlaybackTime', { entryId: 'en' }), /家长验证/);
  let saved = JSON.parse(data.get('pipikids-v1'));
  assert.equal(saved.playbackStats.en.totalMs, 4000);
  const before = structuredClone(saved.playback);
  const { token } = await call('unlock', { pin: '2468' }); // Fresh, isolated test state only.
  await call('resetPlaybackTime', { token, entryId: 'en' });
  saved = JSON.parse(data.get('pipikids-v1'));
  assert.equal(saved.playbackStats.en.totalMs, 0); assert.ok(saved.playbackStats.en.resetAt > 0);
  assert.equal(saved.playbackStats.other.totalMs, 2000); assert.deepEqual(saved.playback, before);
  const restarted = await import('../src/bridge.js?statistics-restart');
  const state = await restarted.call('getState');
  assert.equal(state.statistics.series.en.totalMs, 0); assert.equal(state.statistics.series.other.totalMs, 2000);
  assert.equal(state.statistics.englishVideoMs, 0);
});
