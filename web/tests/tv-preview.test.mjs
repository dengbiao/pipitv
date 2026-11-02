import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogMedia, previewRange } from '../scripts/tv-preview.mjs';

test('TV preview serves only indexed media inside a configured series', () => {
  const id = 'a'.repeat(24), file = { id, path: '/USB/series/01.mp4', size: 100 };
  const catalog = { entries: [{ path: '/USB/series' }], files: [file] };
  assert.equal(catalogMedia(catalog, id), file);
  assert.equal(catalogMedia(catalog, '../../other'), null);
  assert.equal(catalogMedia({ ...catalog, files: [{ ...file, path: '/USB/series-copy/01.mp4' }] }, id), null);
  assert.equal(catalogMedia({ ...catalog, files: [{ ...file, size: -1 }] }, id), null);
});

test('TV preview supports start/end/suffix byte ranges and rejects invalid ranges', () => {
  assert.deepEqual(previewRange(undefined, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(previewRange('bytes=0-9', 100), { start: 0, end: 9, partial: true });
  assert.deepEqual(previewRange('bytes=90-', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(previewRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  assert.equal(previewRange('bytes=100-', 100), null);
  assert.equal(previewRange('bytes=9-1', 100), null);
  assert.equal(previewRange('bytes=0-1,3-4', 100), null);
  assert.equal(previewRange('bytes=-0', 100), null);
});
