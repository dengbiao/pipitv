import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalTarget } from '../src/focus-geometry.js';

const box = (id, x, y, width = 100, height = 100) => ({ id, rect: { x, y, width, height } });
test('TV cards move horizontally without jumping to the parent button at the edge', () => {
  const cards = [box('first', 0, 200), box('second', 120, 200), box('third', 240, 200), box('parent', 350, 0, 60, 40)];
  assert.equal(directionalTarget(cards[0].rect, cards.slice(1), 'ArrowRight').id, 'second');
  assert.equal(directionalTarget(cards[2].rect, [cards[0], cards[1], cards[3]], 'ArrowRight'), null);
  assert.equal(directionalTarget(cards[1].rect, [cards[0], cards[2]], 'ArrowLeft').id, 'first');
  assert.equal(directionalTarget(cards[0].rect, [box('slightly-lower-peer', 120, 204)], 'ArrowDown'), null);
});
test('up and down preserve the keypad column', () => {
  const keys = Array.from({ length: 12 }, (_, i) => box(String(i + 1), (i % 3) * 120, Math.floor(i / 3) * 120));
  assert.equal(directionalTarget(keys[4].rect, keys.filter(k => k !== keys[4]), 'ArrowDown').id, '8');
  assert.equal(directionalTarget(keys[4].rect, keys.filter(k => k !== keys[4]), 'ArrowUp').id, '2');
  assert.equal(directionalTarget(keys[11].rect, keys.slice(0, 11), 'ArrowUp').id, '9');
});
test('the parent button is reachable above the content row', () => {
  const card = box('card', 0, 200), parent = box('parent', 350, 0, 70, 40);
  assert.equal(directionalTarget(card.rect, [parent], 'ArrowUp').id, 'parent');
  assert.equal(directionalTarget(card.rect, [parent], 'Enter'), null);
});
