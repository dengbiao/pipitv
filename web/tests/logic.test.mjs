import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, freshUsage, settleUsage, availability, inAllowedHours, isWithin, naturalSort, episodeQueue, adjacentEpisode } from '../src/logic.js';
const at = (hour, minute = 0, day = 31) => new Date(2026, 9, day, hour, minute).getTime();
test('a session cannot outlive its limit and starts a persisted rest', () => {
  const settings = { ...DEFAULT_SETTINGS, sessionMinutes: 1, dailyMinutes: 10 };
  let usage = freshUsage(at(10)); usage.active = true;
  usage = settleUsage(usage, settings, at(10, 2), true);
  assert.equal(usage.usedMs, 60000);
  assert.equal(availability(usage, settings, at(10, 2)).reason, 'rest');
  const afterRestart = JSON.parse(JSON.stringify(usage));
  assert.equal(availability(afterRestart, settings, at(10, 3)).reason, 'rest');
  const rested = settleUsage(afterRestart, settings, at(10, 13), false);
  assert.equal(rested.sessionMs, 0); assert.equal(rested.usedMs, 60000);
});
test('returning home preserves session use; daily cap takes precedence', () => {
  const settings = { ...DEFAULT_SETTINGS, sessionMinutes: 2, dailyMinutes: 5 };
  let usage = { ...freshUsage(at(10)), active: true, usedMs: 270000 };
  usage = settleUsage(usage, settings, at(10, 1), false);
  assert.equal(usage.usedMs, 300000); assert.equal(usage.sessionMs, 30000);
  assert.equal(availability(usage, settings, at(10, 1)).reason, 'daily');
});
test('day changes reset today, including extra allowance', () => {
  const settings = { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 };
  let usage = { ...freshUsage(at(23, 59, 30)), usedMs: 900000, extraMs: 300000, active: true };
  usage = settleUsage(usage, settings, at(0, 1), true);
  assert.equal(usage.usedMs, 60000); assert.equal(usage.extraMs, 0);
});
test('allowed hours support an overnight window and all day', () => {
  assert.equal(inAllowedHours({ startHour: 20, endHour: 8 }, at(23)), true);
  assert.equal(inAllowedHours({ startHour: 20, endHour: 8 }, at(12)), false);
  assert.equal(inAllowedHours({ startHour: 0, endHour: 24 }, at(23)), true);
});
test('invalid settings normalize; backward clocks never refund usage', () => {
  assert.equal(normalizeSettings({ dailyMinutes: -10 }).dailyMinutes, 5);
  const usage = { ...freshUsage(at(10)), usedMs: 20000, active: true };
  assert.equal(settleUsage(usage, DEFAULT_SETTINGS, at(9), true).usedMs, 20000);
});
test('directory boundaries and natural file order', () => {
  assert.equal(isWithin('/USB/English/a.mp4', '/USB/English'), true);
  assert.equal(isWithin('/USB/English-copy/a.mp4', '/USB/English'), false);
  assert.deepEqual(naturalSort([{ name: '10.mp4' }, { name: '2.mp4' }, { name: 'Z', kind: 'folder' }]).map(x => x.name), ['Z', '2.mp4', '10.mp4']);
});
test('episodes follow numeric file order and skip folders and other media kinds', () => {
  const files = [
    { path: '/show/10.mp4', name: '10.mp4', kind: 'video' },
    { path: '/show/cover.png', name: 'cover.png', kind: 'image' },
    { path: '/show/1.mp4', name: '1.mp4', kind: 'video' },
    { path: '/show/2.mp4', name: '2.mp4', kind: 'video' },
    { path: '/show/song.mp3', name: 'song.mp3', kind: 'audio' },
    { path: '/show/bonus', name: 'bonus', kind: 'folder' },
  ];
  const queue = episodeQueue(files, files[2]);
  assert.deepEqual(queue.map(file => file.name), ['1.mp4', '2.mp4', '10.mp4']);
  assert.equal(adjacentEpisode(queue, '/show/1.mp4', -1), null);
  assert.equal(adjacentEpisode(queue, '/show/1.mp4', 1).name, '2.mp4');
  assert.equal(adjacentEpisode(queue, '/show/10.mp4', -1).name, '2.mp4');
  assert.equal(adjacentEpisode(queue, '/show/10.mp4', 1), null);
  assert.equal(adjacentEpisode(queue, '/outside.mp4', 1), null);
  assert.equal(adjacentEpisode(queue, '/show/1.mp4', 0), null);
  assert.deepEqual(episodeQueue(files, files[4]), [files[4]]);
  assert.deepEqual(episodeQueue(files, files[1]), [files[1]]);
});
test('a direct-file entry or unavailable folder never picks unrelated siblings', () => {
  const file = { path: '/chosen/2.mp4', name: '2.mp4', kind: 'video' };
  assert.deepEqual(episodeQueue(undefined, file), [file]);
  assert.deepEqual(episodeQueue([{ path: '/other/1.mp4', name: '1.mp4', kind: 'video' }], file), [file]);
});
test('continuous episodes share a session and stop at its original limit', () => {
  const settings = { ...DEFAULT_SETTINGS, sessionMinutes: 1, dailyMinutes: 10 };
  let usage = { ...freshUsage(at(10)), active: true };
  for (const seconds of [20, 40, 61]) usage = settleUsage(usage, settings, at(10) + seconds * 1000, true);
  assert.equal(usage.usedMs, 60000); assert.equal(usage.sessionMs, 60000);
  assert.equal(availability(usage, settings, at(10) + 61000).reason, 'rest');
});
