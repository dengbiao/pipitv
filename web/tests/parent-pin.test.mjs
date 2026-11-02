import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsParentPin, createParentPinFlow } from '../src/parent-pin.js';

const enter = (flow, digits) => { for (const digit of digits) flow.append(digit); };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const calls = { auth: [], change: [], discard: [], success: [], focus: 0 };
  const flow = createParentPinFlow({ pinSet: true, pinLength: 4,
    authenticate: async pin => { calls.auth.push(pin); return { token: 'test-only-token' }; },
    changePin: async (token, pin) => { calls.change.push({ token, pin }); return { token }; },
    discardToken: token => { calls.discard.push(token); },
    onSuccess: result => { calls.success.push(result); }, focusFirst: () => calls.focus++, ...options });
  return { flow, calls };
}
test('new PINs require exactly four ASCII digits; only existing PIN verification accepts older lengths', () => {
  assert.equal(acceptsParentPin('2468'), true);
  for (const pin of ['', '123', '12345', '12345678', '12a4', '１２３４']) assert.equal(acceptsParentPin(pin), false);
  assert.equal(acceptsParentPin('24682468', true), true);
  assert.equal(acceptsParentPin('246824680', true), false);
});
test('fourth digit authenticates automatically once and a slow request blocks further input', async () => {
  let resolve; const calls = [];
  const { flow } = setup({ authenticate: pin => { calls.push(pin); return new Promise(done => { resolve = done; }); } });
  enter(flow, '246'); assert.deepEqual(calls, []);
  enter(flow, '89999'); assert.deepEqual(calls, ['2468']); assert.equal(flow.snapshot().busy, true);
  resolve({ token: 'test-only-token' }); await settle(); enter(flow, '2468'); assert.equal(calls.length, 1);
});
test('new setup automatically advances after four digits and saves only after a matching second entry', async () => {
  const { flow, calls } = setup({ pinSet: false });
  enter(flow, '2468'); assert.equal(flow.snapshot().stage, 'confirm'); assert.equal(flow.snapshot().count, 0);
  assert.equal(calls.auth.length, 0);
  enter(flow, '2468'); await settle(); assert.deepEqual(calls.auth, ['2468']); assert.equal(calls.success.length, 1);
  assert.equal(JSON.stringify(flow.snapshot()).includes('2468'), false);
});
test('a mismatched confirmation never calls the backend and returns to an operable fresh entry', async () => {
  const { flow, calls } = setup({ pinSet: false });
  enter(flow, '2468'); enter(flow, '1357'); assert.equal(calls.auth.length, 0);
  assert.equal(flow.snapshot().stage, 'new'); assert.equal(flow.snapshot().count, 0);
  assert.match(flow.snapshot().message, /两次输入不同/);
  enter(flow, '3579'); enter(flow, '3579'); await settle(); assert.deepEqual(calls.auth, ['3579']);
});
test('incorrect PIN clears digits, preserves error feedback and permits a new four-digit attempt', async () => {
  let attempts = 0;
  const { flow } = setup({ authenticate: async () => { if (++attempts === 1) throw new Error('PIN 不正确'); return { token: 'test-only-token' }; } });
  enter(flow, '1111'); await settle(); assert.equal(flow.snapshot().count, 0); assert.equal(flow.snapshot().busy, false);
  assert.match(flow.snapshot().message, /PIN 不正确/);
  enter(flow, '2468'); await settle(); assert.equal(attempts, 2);
});
test('legacy migration verifies all original digits before accepting and saving a user-chosen four-digit PIN', async () => {
  const { flow, calls } = setup({ pinLength: 0 });
  assert.equal(flow.snapshot().stage, 'legacy'); enter(flow, '2468'); assert.equal(calls.auth.length, 0);
  enter(flow, '2468'); await settle(); assert.deepEqual(calls.auth, ['24682468']);
  assert.equal(flow.snapshot().stage, 'new'); assert.equal(flow.snapshot().length, 4); assert.equal(calls.success.length, 0);
  enter(flow, '3579'); enter(flow, '3579'); await settle();
  assert.deepEqual(calls.change, [{ token: 'test-only-token', pin: '3579' }]); assert.equal(calls.success.length, 1);
  flow.dispose(); assert.equal(calls.discard.length, 0, 'a completed upgrade must not revoke its parent session');
});
test('legacy lengths four through eight remain reachable without truncation or a manual confirm button', async () => {
  for (const length of [4, 5, 6, 7, 8]) {
    const { flow, calls } = setup({ pinLength: 0 }); flow.setLegacyLength(length);
    enter(flow, '1'.repeat(length)); await settle(); assert.deepEqual(calls.auth, ['1'.repeat(length)]); flow.dispose();
  }
});
test('canceling after legacy verification revokes only that grant and never replaces the original PIN', async () => {
  const { flow, calls } = setup({ pinLength: 8 }); enter(flow, '24682468'); await settle();
  enter(flow, '3579'); flow.dispose(); enter(flow, '3579'); await settle();
  assert.deepEqual(calls.discard, ['test-only-token']); assert.equal(calls.change.length, 0); assert.equal(calls.success.length, 0);
});
test('canceling an in-flight verification cannot reopen the parent page and discards the late grant', async () => {
  let resolve; const { flow, calls } = setup({ authenticate: () => new Promise(done => { resolve = done; }) });
  enter(flow, '2468'); flow.dispose(); resolve({ token: 'late-test-token' }); await settle();
  assert.equal(calls.success.length, 0); assert.deepEqual(calls.discard, ['late-test-token']);
});
test('delete and back cancellation work before automatic submission', () => {
  const { flow, calls } = setup(); enter(flow, '246'); flow.erase(); assert.equal(flow.snapshot().count, 2);
  flow.dispose(); enter(flow, '89'); assert.equal(calls.auth.length, 0);
});
