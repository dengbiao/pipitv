import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsAutosave } from '../src/settings-autosave.js';

const settings = { dailyMinutes: 30, sessionMinutes: 15, restMinutes: 10, startHour: 8, endHour: 20, chinese: true };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('rapid choices persist in order without dropping another field or an explicit false/zero', async () => {
  const writes = [], first = deferred(), changes = [];
  const autosave = createSettingsAutosave({ settings,
    save: async next => { writes.push(next); if (writes.length === 1) await first.promise; },
    onChange: state => changes.push(state), onError: assert.fail });
  autosave.update({ dailyMinutes: 60 });
  autosave.update({ startHour: 0 });
  autosave.update({ chinese: false });
  autosave.update({ dailyMinutes: 90 });
  assert.equal(writes.length, 1);
  assert.deepEqual(changes.at(-1).settings, { ...settings, dailyMinutes: 90, startHour: 0, chinese: false });
  let leftParent = false;
  const leave = autosave.flush().then(() => { leftParent = true; });
  await Promise.resolve(); assert.equal(leftParent, false);
  first.resolve(); await leave;
  assert.equal(writes.length, 4);
  assert.deepEqual(writes.at(-1), changes.at(-1).settings);
  assert.equal(changes.at(-1).status, 'saved');
  assert.deepEqual(settings, { dailyMinutes: 30, sessionMinutes: 15, restMinutes: 10, startHour: 8, endHour: 20, chinese: true });
});

test('a failed save rolls back only its choice while later changes still persist', async () => {
  const first = deferred(), writes = [], changes = [], errors = [];
  const autosave = createSettingsAutosave({ settings,
    save: async next => { writes.push(next); if (writes.length === 1) await first.promise; },
    onChange: state => changes.push(state), onError: error => errors.push(error.message) });
  autosave.update({ dailyMinutes: 60 });
  autosave.update({ restMinutes: 20 });
  first.reject(new Error('Storage unavailable')); await autosave.flush();
  assert.deepEqual(errors, ['Storage unavailable']);
  assert.deepEqual(writes.at(-1), { ...settings, restMinutes: 20 });
  assert.deepEqual(changes.at(-1), { settings: { ...settings, restMinutes: 20 }, status: 'saved' });
});

test('a failed final choice restores its persisted value and can be selected again', async () => {
  const changes = [], errors = [];
  let fail = true;
  const autosave = createSettingsAutosave({ settings,
    save: async () => { if (fail) throw new Error('Parent session expired'); },
    onChange: state => changes.push(state), onError: error => errors.push(error.message) });
  autosave.update({ sessionMinutes: 5 }); await autosave.flush();
  assert.deepEqual(changes.at(-1), { settings, status: 'error' });
  assert.deepEqual(errors, ['Parent session expired']);
  fail = false;
  autosave.update({ sessionMinutes: 5 }); await autosave.flush();
  assert.deepEqual(changes.at(-1), { settings: { ...settings, sessionMinutes: 5 }, status: 'saved' });
});

test('selecting the already saved value does not write settings', async () => {
  const autosave = createSettingsAutosave({ settings, save: assert.fail, onChange: assert.fail, onError: assert.fail });
  autosave.update({ dailyMinutes: 30 }); await autosave.flush();
});
