import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverContent, normalizeScanPaths, reconcileContent, visibleEntries, staleEntries } from '../src/content-catalog.js';
const video = path => ({ path, name: path.split('/').at(-1), kind: 'video' });
const records = ['/USB/Guli/01.mp4', '/USB/Guli/Season 2/02.mp4', '/USB/WOW/01.mp4',
  '/USB/Android/app-cache/movie.mp4', '/USB/.hidden/private.mp4', '/USB/LOST.DIR/1.mp4', '/USB-copy/Private/1.mp4'].map(video);
test('parent/child and duplicate scan paths collapse in either order without merging similarly named siblings', () => {
  assert.deepEqual(normalizeScanPaths(['/USB/Guli', '/USB/', '/USB', '/USB-copy', '/USB/WOW/../Guli']), ['/USB', '/USB-copy']);
  assert.deepEqual(normalizeScanPaths(['/USB', '/USB/Guli']), ['/USB']);
  assert.deepEqual(normalizeScanPaths([]), []);
  assert.throws(() => normalizeScanPaths(['USB']), /扫描/);
});
test('configured paths alone produce folder series, nested episodes stay together, and system/hidden folders stay out', () => {
  const entries = discoverContent(records, ['/USB/Guli', '/USB']);
  assert.deepEqual(entries.map(entry => [entry.path, entry.mediaCount]), [['/USB/Guli', 2], ['/USB/WOW', 1]]);
  assert.deepEqual(discoverContent(records, []), []);
  assert.deepEqual(discoverContent(records, ['/USB/Guli']).map(entry => entry.path), ['/USB/Guli']);
});
test('a known nested series stays separate from siblings when an ancestor is added as a scan path', () => {
  const files = ['/USB/Courses/Season A/a.mp4', '/USB/Courses/Season B/b.mp4'].map(video);
  const entries = discoverContent(files, ['/USB'], [{ path: '/USB/Courses/Season A', id: 'old-series' }]);
  assert.deepEqual(entries.map(entry => entry.path), ['/USB/Courses/Season A', '/USB/Courses/Season B']);
});
test('rescanning preserves identity, parent names, hidden state, language, covers and last-played metadata', () => {
  const previous = [{ id: 'original', path: '/USB/Guli', title: '家长自己的标题', subtitle: '自己的说明', language: 'en',
    cover: 'songs', mediaCover: true, hidden: true, lastPlayedPath: '/USB/Guli/01.mp4', lastPlayedAt: 123 }];
  const found = discoverContent(records, ['/USB'], previous);
  const after = reconcileContent(previous, found, ['/USB']);
  for (const key of Object.keys(previous[0])) assert.deepEqual(after[0][key], previous[0][key]);
  assert.equal(after[0].available, true); assert.equal(visibleEntries(after).length, 1);
  const id = after[1].id;
  assert.equal(reconcileContent(after, found, ['/USB'])[1].id, id);
});
test('unplugging or removing all scopes suppresses entries without deleting them and reconnecting restores the same IDs', () => {
  const previous = reconcileContent([], discoverContent(records, ['/USB']), ['/USB']);
  const disconnected = reconcileContent(previous, [], ['/USB']);
  assert.equal(disconnected.length, previous.length); assert.deepEqual(visibleEntries(disconnected), []);
  const removed = reconcileContent(disconnected, [], []);
  assert.equal(removed[0].catalogReason, 'out_of_scope');
  const connected = reconcileContent(removed, discoverContent(records, ['/USB'], removed), ['/USB']);
  assert.deepEqual(connected.map(entry => entry.id), previous.map(entry => entry.id));
  assert.equal(visibleEntries(connected).length, 2);
});

test('deleted entries stay removed through a rescan and reconnect, while restoration retains metadata/history', () => {
  const previous = [{ id: 'own', path: '/USB/Guli', title: 'My title', hidden: false, removed: true, removedAt: 123,
    lastPlayedPath: '/USB/Guli/01.mp4', lastPlayedAt: 456, language: 'en' }];
  const after = reconcileContent(previous, discoverContent(records, ['/USB'], previous), ['/USB']);
  assert.deepEqual(after[0], { ...previous[0], managed: true, available: true, catalogReason: '', sourceRoot: '/USB', mediaCount: 2 });
  assert.equal(visibleEntries(after).some(entry => entry.id === 'own'), false);
  assert.equal(visibleEntries([{ ...after[0], removed: false }])[0].lastPlayedAt, 456);
});

test('old-entry cleanup is source-specific and never treats an unplugged drive as a removed scope', () => {
  const entries = [{ id: 'old-local', path: '/USB/Old', catalogReason: 'out_of_scope' },
    { id: 'offline', path: '/USB/Unplugged', catalogReason: 'offline' },
    { id: 'cloud', source: 'baidu', path: '/baidu/account/1', catalogReason: 'out_of_scope' },
    { id: 'already-removed', path: '/USB/Deleted', catalogReason: 'out_of_scope', removed: true }];
  assert.deepEqual(staleEntries(entries, 'local').map(entry => entry.id), ['old-local']);
  assert.deepEqual(staleEntries(entries, 'baidu').map(entry => entry.id), ['cloud']);
});
