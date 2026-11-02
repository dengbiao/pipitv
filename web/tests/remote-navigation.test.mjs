import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteKey, nextInDirection, topFocusScope } from '../src/remoteNavigation.js';

const element = (x, y, width = 100, height = 100) => ({
  isConnected: true, disabled: false, closest: () => null,
  getBoundingClientRect: () => ({ x, y, left: x, right: x + width, top: y, bottom: y + height, width, height }),
});
test('legacy select/back aliases use the same Enter/Escape path as the native bridge', () => {
  for (const key of ['Select', 'Accept', 'NumpadEnter', 'DPAD_CENTER', 'Enter']) assert.equal(remoteKey({ key }), 'Enter');
  for (const key of ['Back', 'BrowserBack', 'GoBack', 'Esc', 'Escape']) assert.equal(remoteKey({ key }), 'Escape');
  assert.equal(remoteKey({ keyCode: 13 }), 'Enter');
});
test('remote adapter retains the keypad column and does not escape a row horizontally', () => {
  const keys = Array.from({ length: 12 }, (_, index) => element(index % 3 * 120, Math.floor(index / 3) * 120));
  const close = element(350, -140, 40, 40);
  assert.equal(nextInDirection(keys[4], [...keys, close], 'ArrowDown'), keys[7]);
  assert.equal(nextInDirection(keys[11], [...keys, close], 'ArrowRight'), null);
});
test('TV shortcuts keep horizontal navigation in their shelf while Up returns to content', () => {
  const mediaRow = {}, appsRow = {};
  const media = element(0, 0, 300, 180), first = element(0, 240, 180, 70), second = element(210, 240, 180, 70);
  media.closest = selector => selector === '[data-focus-row]' ? mediaRow : null;
  for (const app of [first, second]) app.closest = selector => selector === '[data-focus-row]' ? appsRow : null;
  const candidates = [media, first, second];
  assert.equal(nextInDirection(first, candidates, 'ArrowRight'), second);
  assert.equal(nextInDirection(second, candidates, 'ArrowRight'), null);
  assert.equal(nextInDirection(first, candidates, 'ArrowLeft'), null);
  assert.equal(nextInDirection(first, candidates, 'ArrowUp'), media);
  assert.equal(nextInDirection(media, candidates, 'ArrowDown'), first);
});
test('series actions follow cover, title entry and game vertically despite their different widths', () => {
  const row = {}, column = {}, otherColumn = {};
  const cover = element(0, 0, 350, 197), enter = element(300, 215, 50, 32), game = element(240, 260, 110, 32);
  const otherCover = element(390, 0, 350, 197), app = element(0, 330, 180, 70);
  for (const item of [cover, enter, game]) item.closest = selector => selector === '[data-focus-column]' ? column : selector === '[data-focus-row]' ? row : null;
  otherCover.closest = selector => selector === '[data-focus-column]' ? otherColumn : selector === '[data-focus-row]' ? row : null;
  const candidates = [cover, enter, game, otherCover, app];
  assert.equal(nextInDirection(cover, candidates, 'ArrowDown'), enter);
  assert.equal(nextInDirection(enter, candidates, 'ArrowDown'), game);
  assert.equal(nextInDirection(game, candidates, 'ArrowUp'), enter);
  assert.equal(nextInDirection(enter, candidates, 'ArrowUp'), cover);
  assert.equal(nextInDirection(cover, candidates, 'ArrowRight'), otherCover);
  assert.equal(nextInDirection(game, candidates, 'ArrowDown'), app);
  assert.equal(nextInDirection(enter, candidates.filter(item => item !== game), 'ArrowDown'), app);
});
test('only the last visible scope owns navigation, even with multiple active ancestors', () => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible' });
  try {
    const page = element(0, 0), dialog = element(0, 0), nested = element(0, 0), hidden = { ...element(0, 0), hidden: true };
    assert.equal(topFocusScope({ querySelectorAll: () => [page, dialog, nested, hidden] }), nested);
  } finally { globalThis.getComputedStyle = previous; }
});
