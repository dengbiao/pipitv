import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';

let sequence = 0;
async function isolatedBridge(legacy = false, extraEntries = []) {
  const originals = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  const salt = '09'.repeat(16);
  const seed = { entries: [{ id: 'fixture', title: 'Fixture', path: '/fixture', kind: 'folder' }, ...extraEntries],
    settings: { ...DEFAULT_SETTINGS }, usage: freshUsage(), failures: 0, lockUntil: 0,
    playback: { fixture: { root: '/fixture', resumePath: '/fixture/1.mp4', items: {} } },
    playbackStats: { fixture: { totalMs: 12345 } }, gameSettings: { fixture: { rounds: 2 } },
    pinHash: legacy ? pbkdf2Sync('24682468', Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex') : '', pinSalt: legacy ? salt : '' };
  let raw = JSON.stringify(seed);
  globalThis.window = {}; globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: key => key === 'pipikids-v1' ? raw : null,
    setItem: (key, value) => { if (key === 'pipikids-v1') raw = value; } };
  const { call } = await import(`../src/bridge.js?pin-backend-test=${++sequence}`);
  return { call, seed, state: () => JSON.parse(raw), restore() {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  } };
}
function unchangedContent(before, after) {
  for (const key of ['entries', 'settings', 'playback', 'playbackStats', 'gameSettings']) assert.deepEqual(after[key], before[key]);
}
test('backend refuses a new eight-digit PIN and requires authenticated four-digit replacement', async () => {
  const env = await isolatedBridge();
  try {
    await assert.rejects(env.call('unlock', { pin: '24682468' }), /4 位/);
    assert.equal(env.state().pinHash, '');
    const session = await env.call('unlock', { pin: '2468' }); const originalHash = env.state().pinHash;
    await assert.rejects(env.call('changePin', { token: 'wrong-test-token', pin: '1357' }), /验证已过期/);
    await assert.rejects(env.call('changePin', { token: session.token, pin: '13571357' }), /4 位/);
    assert.equal(env.state().pinHash, originalHash); unchangedContent(env.seed, env.state());
  } finally { env.restore(); }
});
test('legacy migration checks the entire old PIN, replaces its salt/hash and preserves content, limits and progress', async () => {
  const env = await isolatedBridge(true);
  try {
    const session = await env.call('unlock', { pin: '24682468' }); assert.equal(env.state().pinHash, env.seed.pinHash);
    await env.call('changePin', { token: session.token, pin: '1357' });
    assert.equal(env.state().pinLength, 4); assert.notEqual(env.state().pinHash, env.seed.pinHash); assert.notEqual(env.state().pinSalt, env.seed.pinSalt);
    await assert.rejects(env.call('unlock', { pin: '24682468' }), /PIN 不正确/);
    await env.call('unlock', { pin: '1357' }); unchangedContent(env.seed, env.state());
  } finally { env.restore(); }
});
test('canceling an old grant preserves the PIN and cannot revoke a newer parent session', async () => {
  const env = await isolatedBridge(true);
  try {
    const oldSession = await env.call('unlock', { pin: '24682468' });
    const newSession = await env.call('unlock', { pin: '24682468' });
    await env.call('discardParent', { token: oldSession.token });
    await env.call('saveSettings', { token: newSession.token, settings: env.seed.settings });
    await env.call('discardParent', { token: newSession.token });
    await assert.rejects(env.call('saveSettings', { token: newSession.token, settings: env.seed.settings }), /验证已过期/);
    assert.equal(env.state().pinHash, env.seed.pinHash); unchangedContent(env.seed, env.state());
  } finally { env.restore(); }
});

test('visibility changes need a parent grant and metadata edits cannot repoint or recreate an entry', async () => {
  const env = await isolatedBridge();
  try {
    await assert.rejects(env.call('setEntryVisibility', { token: 'invalid', id: 'fixture', hidden: true }), /验证已过期/);
    await assert.rejects(env.call('saveScanRoots', { token: 'invalid', paths: ['/other'] }), /验证已过期/);
    const session = await env.call('unlock', { pin: '2468' });
    await env.call('setEntryVisibility', { token: session.token, id: 'fixture', hidden: true });
    await assert.rejects(env.call('planPlayback', { entryId: 'fixture' }), /暂未显示/);
    await env.call('saveEntry', { token: session.token, entry: { id: 'fixture', title: '中文名称', subtitle: '中文说明', path: '/other', language: 'en' } });
    const state = env.state();
    assert.equal(state.entries.length, 1); assert.equal(state.entries[0].path, '/fixture'); assert.equal(state.entries[0].hidden, true);
    assert.equal(state.entries[0].title, '中文名称'); assert.equal(state.entries[0].subtitle, '中文说明');
    for (const key of ['settings', 'playback', 'playbackStats', 'gameSettings']) assert.deepEqual(state[key], env.seed[key]);
    await assert.rejects(env.call('saveEntry', { token: session.token, entry: { id: 'new-entry', title: 'New', path: '/other' } }), /不在当前系列/);
    await env.call('setEntryVisibility', { token: session.token, id: 'fixture', hidden: false });
    assert.equal(env.state().entries[0].hidden, false);
  } finally { env.restore(); }
});

test('parent deletion and restoration retain the record, visibility choice and playback state', async () => {
  const env = await isolatedBridge();
  try {
    await assert.rejects(env.call('removeEntry', { id: 'fixture' }), /验证已过期/);
    await assert.rejects(env.call('restoreEntry', { id: 'fixture' }), /验证已过期/);
    const session = await env.call('unlock', { pin: '2468' });
    await env.call('removeEntry', { token: session.token, id: 'fixture' });
    const state = env.state(); assert.equal(state.entries.length, 1); assert.equal(state.entries[0].removed, true);
    assert.equal(state.entries[0].hidden, env.seed.entries[0].hidden);
    for (const key of ['playback', 'playbackStats', 'gameSettings']) assert.deepEqual(state[key], env.seed[key]);
    await env.call('restoreEntry', { token: session.token, id: 'fixture' });
    assert.equal(env.state().entries[0].removed, false); assert.equal(env.state().entries[0].title, 'Fixture');
  } finally { env.restore(); }
});

test('batch cleanup validates every selected stale entry before changing anything and stays within its source', async () => {
  const env = await isolatedBridge(false, [{ id: 'old', path: '/old', catalogReason: 'out_of_scope' },
    { id: 'offline', path: '/USB/unplugged', catalogReason: 'offline' },
    { id: 'cloud', path: '/baidu/account/1', source: 'baidu', catalogReason: 'out_of_scope' }]);
  try {
    const { token } = await env.call('unlock', { pin: '2468' }), before = env.state();
    await assert.rejects(env.call('clearStaleEntries', { token, source: 'local', ids: ['old', 'offline'] }), /范围已变化/);
    await assert.rejects(env.call('clearStaleEntries', { token, source: 'local', ids: ['cloud'] }), /范围已变化/);
    unchangedContent(before, env.state());
    for (const key of ['pinHash', 'pinSalt', 'pinLength']) assert.deepEqual(env.state()[key], before[key]);
    for (const key of ['usedMs', 'sessionMs', 'extraMs', 'restUntil']) assert.equal(env.state().usage[key], before.usage[key]);
    assert.equal(await env.call('clearStaleEntries', { token, source: 'local', ids: ['old'] }), 1);
    assert.equal(env.state().entries.find(entry => entry.id === 'old').removed, true);
    assert.equal(env.state().entries.find(entry => entry.id === 'cloud').removed, undefined);
    for (const key of ['settings', 'playback', 'playbackStats', 'gameSettings', 'pinHash', 'pinSalt']) assert.deepEqual(env.state()[key], before[key]);
  } finally { env.restore(); }
});
