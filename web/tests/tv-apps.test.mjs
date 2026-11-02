import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';

let sequence = 0;
async function fixture(inventory = [{ packageName: 'fixture.tv', label: '电视应用示例' }]) {
  const previous = Object.fromEntries(['window', 'document', 'localStorage'].map(key => [key, globalThis[key]]));
  const seed = { entries: [{ id: 'series', path: '/usb/series', title: 'Series', kind: 'folder' }],
    settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 }, usage: freshUsage(),
    playback: { series: { root: '/usb/series', resumePath: '/usb/series/1.mp4' } },
    playbackStats: { series: { totalMs: 98765 } }, gameSettings: { series: { rounds: 0 } } };
  let raw = JSON.stringify(seed), failWrite = false;
  globalThis.window = { __PIPI_PREVIEW_APPS__: inventory }; globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: () => raw, setItem: (_, value) => {
    const state = JSON.parse(value);
    if (failWrite && (state.tvApps?.length || Object.keys(state.tvAppManaged || {}).length)) throw new Error('storage full');
    raw = value;
  } };
  const reload = async () => (await import(`../src/bridge.js?tv-apps-test=${++sequence}`)).call;
  const call = await reload();
  return { call, seed, reload, state: () => JSON.parse(raw), failWrites: () => { failWrite = true; }, restore() {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  } };
}

test('only an authenticated parent can select installed apps; nothing is enabled by default', async () => {
  const env = await fixture();
  try {
    await assert.rejects(env.call('listTvApps'), /家长验证已过期/);
    await assert.rejects(env.call('setTvAppVisibility', { packageName: 'fixture.tv', visible: true }), /家长验证已过期/);
    await assert.rejects(env.call('setTvAppManaged', { packageName: 'fixture.tv', managed: true }), /家长验证已过期/);
    await assert.rejects(env.call('launchTvApp', { packageName: 'fixture.tv' }), /家长先添加/);
    const { token } = await env.call('unlock', { pin: '2468' });
    const result = await env.call('listTvApps', { token });
    assert.equal(result.apps[0].selected, false);
    assert.equal(result.apps[0].managed, false, 'existing apps default to unlimited');
    await assert.rejects(env.call('setTvAppVisibility', { token, packageName: 'unknown', visible: true }), /卸载或无法打开/);
    await assert.rejects(env.call('setTvAppVisibility', { token, packageName: 'fixture.tv', visible: 'false' }), /是否显示/);
    await env.call('leaveParent');
    await assert.rejects(env.call('setTvAppVisibility', { token, packageName: 'fixture.tv', visible: true }), /家长验证已过期/);
  } finally { env.restore(); }
});

test('app selection survives restart/uninstall/reinstall and preserves media, PIN, settings and history', async () => {
  const inventory = [{ packageName: 'fixture.tv', label: '电视应用示例' }], env = await fixture(inventory);
  try {
    let call = env.call; const session = await call('unlock', { pin: '2468' });
    const credentials = { pinHash: env.state().pinHash, pinSalt: env.state().pinSalt, pinLength: env.state().pinLength };
    await call('setTvAppVisibility', { token: session.token, packageName: 'fixture.tv', visible: true });
    await call('setTvAppVisibility', { token: session.token, packageName: 'fixture.tv', visible: true });
    assert.equal(env.state().tvApps.length, 1, 'repeated activation must not duplicate a shortcut');
    for (const key of ['entries', 'settings', 'playback', 'playbackStats', 'gameSettings']) assert.deepEqual(env.state()[key], env.seed[key]);
    for (const [key, value] of Object.entries(credentials)) assert.equal(env.state()[key], value);
    call = await env.reload(); const { token } = await call('unlock', { pin: '2468' });
    assert.equal((await call('listTvApps', { token })).apps[0].selected, true);
    inventory.pop();
    assert.deepEqual((await call('listTvApps', { token })).apps.map(app => [app.selected, app.available]), [[true, false]]);
    inventory.push({ packageName: 'fixture.tv', label: '重新安装的应用' });
    assert.equal((await call('listTvApps', { token })).apps[0].available, true);
    await assert.rejects(call('launchTvApp', { packageName: 'fixture.tv' }), /浏览器仅支持界面预览/);
    const hour = new Date().getHours();
    await call('saveSettings', { token, settings: { ...env.seed.settings, startHour: (hour + 1) % 24, endHour: (hour + 2) % 24 } });
    await assert.rejects(call('launchTvApp', { packageName: 'fixture.tv' }), /浏览器仅支持界面预览/);
    await call('setTvAppManaged', { token, packageName: 'fixture.tv', managed: true });
    await assert.rejects(call('launchTvApp', { packageName: 'fixture.tv' }), /休息时间/);
    await call('setTvAppVisibility', { token, packageName: 'fixture.tv', visible: false });
    assert.deepEqual(env.state().tvApps, []);
    await assert.rejects(call('launchTvApp', { packageName: 'fixture.tv' }), /家长先添加/);
  } finally { env.restore(); }
});

test('failed app writes keep the previous selection and browsers do not invent installed apps', async () => {
  const env = await fixture();
  try {
    const { token } = await env.call('unlock', { pin: '2468' }); env.failWrites();
    await assert.rejects(env.call('setTvAppVisibility', { token, packageName: 'fixture.tv', visible: true }), /storage full/);
    await assert.rejects(env.call('setTvAppManaged', { token, packageName: 'fixture.tv', managed: true }), /storage full/);
    assert.equal((await env.call('listTvApps', { token })).apps[0].selected, false);
    assert.equal((await env.call('listTvApps', { token })).apps[0].managed, false);
    delete window.__PIPI_PREVIEW_APPS__;
    const call = await env.reload(); const session = await call('unlock', { pin: '2468' });
    const unsupported = await call('listTvApps', session); assert.equal(unsupported.supported, false); assert.deepEqual(unsupported.apps, []);
    await assert.rejects(call('setTvAppVisibility', { ...session, packageName: 'fixture.tv', visible: true }), /电视上的 PIPI KIDS/);
  } finally { env.restore(); }
});

test('managed apps share restrictions while unmanaged apps stay unlimited; homepage membership is independent', async () => {
  const env = await fixture([{ packageName: 'fixture.tv', label: '受控应用示例' }, { packageName: 'fixture.free', label: '不限时示例' }]);
  try {
    const { token } = await env.call('unlock', { pin: '2468' });
    await env.call('setTvAppManaged', { token, packageName: 'fixture.tv', managed: true });
    let catalog = await env.call('listTvApps', { token });
    assert.equal(catalog.apps[0].selected, false); assert.equal(catalog.apps[0].managed, true);
    for (const packageName of ['fixture.tv', 'fixture.free']) await env.call('setTvAppVisibility', { token, packageName, visible: true });
    const hour = new Date().getHours();
    await env.call('saveSettings', { token, settings: { ...env.seed.settings, startHour: (hour + 1) % 24, endHour: (hour + 2) % 24 } });
    await assert.rejects(env.call('launchTvApp', { packageName: 'fixture.tv' }), /休息时间/);
    await assert.rejects(env.call('launchTvApp', { packageName: 'fixture.free' }), /浏览器仅支持界面预览/);
    window.__PIPI_PREVIEW_APP_CONTROL__ = { enabled: false, ready: false };
    await assert.rejects(env.call('launchTvApp', { packageName: 'fixture.tv' }), /先开启应用管控权限/);
    await assert.rejects(env.call('launchTvApp', { packageName: 'fixture.free' }), /浏览器仅支持界面预览/);
    await env.call('setTvAppVisibility', { token, packageName: 'fixture.tv', visible: false });
    const call = await env.reload(); const session = await call('unlock', { pin: '2468' });
    catalog = await call('listTvApps', session);
    assert.equal(catalog.apps[0].managed, true); assert.equal(catalog.apps[0].selected, false);
    await call('setTvAppManaged', { ...session, packageName: 'fixture.tv', managed: false });
    assert.equal((await call('listTvApps', session)).apps[0].managed, false);
    for (const key of ['entries', 'playback', 'playbackStats', 'gameSettings']) assert.deepEqual(env.state()[key], env.seed[key]);
    await call('leaveParent');
    await assert.rejects(call('setTvAppManaged', { ...session, packageName: 'fixture.free', managed: true }), /家长验证已过期/);
  } finally { env.restore(); }
});
