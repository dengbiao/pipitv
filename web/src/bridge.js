import { DEFAULT_SETTINGS, normalizeSettings, freshUsage, settleUsage, availability, mediaKind, naturalSort, isWithin } from './logic.js';
import { PLAYBACK_MODES, MODE_DEFAULT_VERSION, storedPlaybackMode, freshSeries, selectPlayback, startPlayback, progressPlayback, completePlayback } from './playback.js';
import { restReminderById, restReminderSource } from './rest-reminders.js';
import { addPlaybackTime, freshPlaybackStats, playbackStatistics } from './playback-stats.js';
import { finishGameWatch, gameContent, gameRounds, gameStatus, recordGameWatch } from './games.js';
import { createGameSpeechPlayer } from './game-speech.js';
import { validGameTransition } from './game-sessions.js';
import { acceptsParentPin } from './parent-pin.js';
import { discoverContent, normalizeScanPaths, reconcileContent, visibleEntries, withinScanPath, staleEntries } from './content-catalog.js';

export const isNative = !!window.PipiTV;
const STORAGE_KEY = 'pipikids-v1';
const covers = ['animals', 'colors', 'songs'];
const names = [['Animals', '动物世界'], ['Colors', '色彩启蒙'], ['Songs', '英文儿歌']];
// The development preview supplies a read-only catalog of the actual TV USB.
const previewCatalog = window.__PIPI_PREVIEW_CATALOG__;
// Only isolated QA fixtures supply an inventory; normal browsers cannot discover TV apps.
const previewApps = window.__PIPI_PREVIEW_APPS__;
const defaultEntries = covers.map((cover, i) => ({ id: `demo-${cover}`, title: names[i][0], subtitle: names[i][1],
  cover, path: `/demo/${names[i][0]}`, kind: 'folder', demo: true }));
const demoFiles = covers.map((cover, i) => ({ path: `/demo/${names[i][0]}/${names[i][1]}.png`, name: `${names[i][1]}.png`,
  kind: 'image', src: `art/${cover}.png`, size: 0, builtin: true }));
let stored;
try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* Recover an interrupted first save. */ }
let state = { entries: defaultEntries, settings: DEFAULT_SETTINGS, usage: freshUsage(), pinHash: '', pinSalt: '',
  failures: 0, lockUntil: 0, ...stored };
state.settings = normalizeSettings(state.settings);
state.playback ||= {};
state.playbackStats ||= {};
state.gameSettings ||= {};
state.gameProgress ||= {};
function entryFor(id, path) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry || (path && !(entry.kind === 'folder' ? isWithin(path, entry.path) : path === entry.path))) {
    throw new Error('这个文件不在当前系列中。');
  }
  return entry;
}
function seriesFor(entry) {
  if (state.playback[entry.id]?.root !== entry.path) state.playback[entry.id] = freshSeries(entry.path);
  const series = state.playback[entry.id];
  series.mode = storedPlaybackMode(series.mode, series.modeDefaultVersion);
  series.modeDefaultVersion = MODE_DEFAULT_VERSION;
  return series;
}
function playbackSummaries() {
  return Object.fromEntries(state.entries.map(entry => {
    const series = seriesFor(entry), item = series.items[series.resumePath];
    return [entry.id, { mode: series.mode, resumePath: series.resumePath, resumeMs: item?.positionMs || 0 }];
  }));
}
let authToken = '', authUntil = 0, parentMode = false, learning = false;
let catalogAt = 0, catalogState = null;
async function scanContent(force = false) {
  if (!force && catalogState && Date.now() - catalogAt < 15000) return catalogState;
  let records;
  try { records = await fileRecords(); }
  catch {
    // A browser storage failure must not erase its catalog or block parent settings/statistics.
    const roots = Array.isArray(state.scanRoots) ? normalizeScanPaths(state.scanRoots) : null;
    if (roots) state.entries = state.entries.map(entry => roots.some(root => withinScanPath(entry.path, root)) ? entry : { ...entry, available: false, catalogReason: 'out_of_scope' });
    catalogAt = Date.now();
    catalogState = { roots: (roots || []).map(path => ({ path, name: path.split('/').at(-1), available: false })), complete: false, configured: !!roots, scannedAt: 0 };
    return catalogState;
  }
  if (!Array.isArray(state.scanRoots)) {
    const paths = previewCatalog?.entries?.map(entry => entry.path) || records.filter(file => !file.builtin).map(file => file.path);
    state.scanRoots = normalizeScanPaths(paths.length ? paths.map(path => path.startsWith('/storage/') ? '/' + path.split('/').filter(Boolean).slice(0, 2).join('/') : '/' + path.split('/').filter(Boolean)[0]) : ['/demo']);
  }
  const roots = normalizeScanPaths(state.scanRoots), candidates = discoverContent(records, roots, state.entries);
  state.scanRoots = roots; state.entries = reconcileContent(state.entries, candidates, roots);
  catalogState = { roots: roots.map(path => ({ path, name: path.split('/').at(-1), available: records.some(file => withinScanPath(file.path, path)) })),
    scannedAt: Date.now(), complete: true, configured: true, discovered: candidates.length };
  catalogAt = Date.now(); save(); return catalogState;
}
function childEntry(id, path) {
  const entry = entryFor(id, path);
  if (entry.removed || entry.hidden || entry.available === false || (Array.isArray(state.scanRoots) && !state.scanRoots.some(root => withinScanPath(entry.path, root)))) throw new Error('这个内容暂未显示，或存储尚未连接。');
  return entry;
}
function tvAppCatalog() {
  const selected = new Map((state.tvApps || []).map(app => [app.packageName, app]));
  const managed = state.tvAppManaged || {};
  const installed = new Map((previewApps || []).map(app => [app.packageName, app]));
  const known = new Map([...Object.entries(managed).map(([packageName, label]) => [packageName, { packageName, label }]), ...selected]);
  return [...installed.values()].map(app => ({ ...app, available: app.available !== false, selected: selected.has(app.packageName), managed: !!managed[app.packageName] }))
    .concat([...known.values()].filter(app => !installed.has(app.packageName)).map(app => ({ ...app, available: false, selected: selected.has(app.packageName), managed: !!managed[app.packageName] })));
}
function tvAppControl() {
  return { supported: !!previewApps, enabled: !!previewApps, ready: !!previewApps, managedCount: Object.keys(state.tvAppManaged || {}).length,
    ...window.__PIPI_PREVIEW_APP_CONTROL__ };
}
let restAudio = null;
let gameSession = null;
const gameSpeech = createGameSpeechPlayer();
const stopGameAudio = () => gameSpeech.stop();
async function gameStatuses() {
  const records = await fileRecords().catch(() => []);
  return Object.fromEntries(state.entries.map(entry => {
    const paths = records.filter(file => ['video', 'audio'].includes(file.kind) &&
      (entry.kind === 'folder' ? isWithin(file.path, entry.path) : file.path === entry.path)).map(file => file.path);
    return [entry.id, gameStatus(paths, seriesFor(entry).items, state.gameSettings[entry.id]?.rounds)];
  }));
}
function stopRestReminder() {
  if (!restAudio) return;
  restAudio.pause(); restAudio.removeAttribute('src'); restAudio.load(); restAudio = null;
}
const toHex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/.{2}/g) || [], s => parseInt(s, 16));
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const tick = () => {
  state.usage = settleUsage(state.usage, state.settings, Date.now(), learning && !parentMode && !document.hidden);
  save();
};
function authorize(token) {
  if (!token || token !== authToken || authUntil < Date.now()) throw new Error('家长验证已过期，请重新输入 PIN。');
  authUntil = Date.now() + 10 * 60000;
}
async function pinHash(pin, salt) {
  const [{ pbkdf2Async }, { sha256 }] = await Promise.all([import('@noble/hashes/pbkdf2.js'), import('@noble/hashes/sha2.js')]);
  return toHex(await pbkdf2Async(sha256, new TextEncoder().encode(pin), fromHex(salt), { c: 100000, dkLen: 32 }));
}
const db = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('pipikids-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function fileRecords() {
  const handle = await db();
  return new Promise((resolve, reject) => {
    const tx = handle.transaction('files', 'readonly'); const request = tx.objectStore('files').getAll();
    request.onsuccess = () => resolve([...demoFiles, ...(previewCatalog?.files || []), ...request.result]);
    request.onerror = () => reject(request.error); tx.oncomplete = () => handle.close();
  });
}
function allowedPath(path, token) {
  if (token) { authorize(token); return; }
  if (!visibleEntries(state.entries).some(e => (!Array.isArray(state.scanRoots) || state.scanRoots.some(root => withinScanPath(e.path, root))) && (e.kind === 'folder' ? isWithin(path, e.path) : path === e.path))) {
    throw new Error('这个位置需要家长打开。');
  }
}
async function browserCall(method, args = {}) {
  tick();
  switch (method) {
    case 'announceRest': {
      stopRestReminder();
      const reminder = restReminderById(args.id);
      if (!reminder || document.hidden || !availability(state.usage, state.settings).reason) return false;
      const audio = new Audio(restReminderSource(reminder)); restAudio = audio;
      audio.loop = false;
      try { await audio.play(); return true; } catch { return false; }
    }
    case 'stopRestReminder': stopRestReminder(); return true;
    case 'getState': {
      const catalog = await scanContent();
      return { entries: state.entries, catalog, playback: playbackSummaries(), games: await gameStatuses(), statistics: playbackStatistics(state.entries, state.playbackStats), settings: state.settings, usage: state.usage,
      access: availability(state.usage, state.settings), pinSet: !!state.pinHash, pinLength: state.pinHash ? state.pinLength || 0 : 0,
      tvApps: previewApps ? tvAppCatalog().filter(app => app.selected) : [], tvAppControl: tvAppControl(), native: false, device: '浏览器预览' };
    }
    case 'unlock': {
      if (state.lockUntil > Date.now()) throw new Error('请稍候一分钟，再输入家长 PIN。');
      if (!acceptsParentPin(args.pin, !!state.pinHash)) throw new Error(state.pinHash ? '请输入原来的 PIN。' : '请输入 4 位数字 PIN。');
      if (!state.pinHash) {
        const salt = crypto.getRandomValues(new Uint8Array(16)); state.pinSalt = toHex(salt);
        state.pinHash = await pinHash(args.pin, state.pinSalt);
      } else if (await pinHash(args.pin, state.pinSalt) !== state.pinHash) {
        state.failures += 1;
        if (state.failures >= 5) { state.lockUntil = Date.now() + 60000; state.failures = 0; }
        save(); throw new Error('PIN 不正确，请再试一次。');
      }
      state.failures = 0; state.lockUntil = 0; state.pinLength = args.pin.length;
      authToken = toHex(crypto.getRandomValues(new Uint8Array(16))); authUntil = Date.now() + 10 * 60000;
      parentMode = true; tick(); save(); return { token: authToken };
    }
    case 'changePin': {
      authorize(args.token);
      if (!acceptsParentPin(args.pin, false)) throw new Error('请输入 4 位数字 PIN。');
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await pinHash(args.pin, salt);
      authorize(args.token);
      state.pinSalt = salt; state.pinHash = hash; state.pinLength = 4;
      state.failures = 0; state.lockUntil = 0; save();
      return { token: authToken };
    }
    case 'discardParent':
      if (args.token && args.token === authToken) { parentMode = false; authToken = ''; authUntil = 0; tick(); }
      return true;
    case 'leaveParent': parentMode = false; authToken = ''; tick(); return true;
    case 'listTvApps': authorize(args.token); return { supported: !!previewApps, apps: previewApps ? tvAppCatalog() : [], control: tvAppControl() };
    case 'setTvAppVisibility': {
      authorize(args.token);
      if (!previewApps) throw new Error('请在电视上的 PIPI KIDS 中选择应用。');
      if (typeof args.visible !== 'boolean') throw new Error('请选择是否显示这个应用。');
      const app = tvAppCatalog().find(app => app.packageName === args.packageName);
      if (args.visible && (!app || !app.available)) throw new Error('这个应用已卸载或无法打开，请刷新应用列表。');
      const previous = state.tvApps;
      const next = (previous || []).filter(app => app.packageName !== args.packageName);
      if (args.visible) next.push({ packageName: app.packageName, label: app.label });
      state.tvApps = next;
      try { save(); } catch (error) { state.tvApps = previous; throw error; }
      return { supported: true, apps: tvAppCatalog(), control: tvAppControl() };
    }
    case 'setTvAppManaged': {
      authorize(args.token);
      if (!previewApps) throw new Error('请在电视上的 PIPI KIDS 中选择应用。');
      if (typeof args.managed !== 'boolean') throw new Error('请选择是否加入管控。');
      const app = tvAppCatalog().find(app => app.packageName === args.packageName);
      if (args.managed && (!app || !app.available)) throw new Error('这个应用已卸载或无法打开，请刷新应用列表。');
      const previous = state.tvAppManaged;
      const next = { ...previous };
      if (args.managed) next[args.packageName] = app.label;
      else delete next[args.packageName];
      state.tvAppManaged = next;
      try { save(); } catch (error) { state.tvAppManaged = previous; throw error; }
      return { supported: true, apps: tvAppCatalog(), control: tvAppControl() };
    }
    case 'openAppControlSettings': authorize(args.token); throw new Error('请在电视上开启应用管控权限，浏览器仅支持界面预览。');
    case 'launchTvApp': {
      if (!(state.tvApps || []).some(app => app.packageName === args.packageName)) throw new Error('这个应用需要家长先添加到首页。');
      if (state.tvAppManaged?.[args.packageName]) {
        if (!tvAppControl().ready) throw new Error('请家长先开启应用管控权限，这个应用的管控设置才会生效。');
        if (availability(state.usage, state.settings).reason) throw new Error('现在是休息时间。');
      }
      throw new Error('请在电视上打开应用，浏览器仅支持界面预览。');
    }
    case 'saveSettings': authorize(args.token); state.settings = normalizeSettings(args.settings);
      if (state.usage.sessionMs >= state.settings.sessionMinutes * 60000 && state.usage.restUntil <= Date.now()) {
        state.usage.restUntil = Date.now() + state.settings.restMinutes * 60000;
      }
      save(); return true;
    case 'saveEntry': {
      authorize(args.token); const entry = args.entry;
      if (!entry?.title?.trim()) throw new Error('请填写入口名称。');
      const current = entryFor(entry.id);
      const clean = { ...current, title: entry.title.trim().slice(0, 40), subtitle: (entry.subtitle || '').trim().slice(0, 80),
        language: entry.language === 'other' ? 'other' : 'en', customTitle: true };
      state.entries = state.entries.map(e => e.id === clean.id ? clean : e);
      save(); return clean;
    }
    case 'saveScanRoots': {
      authorize(args.token); state.scanRoots = normalizeScanPaths(args.paths);
      save(); return scanContent(true);
    }
    case 'scanContent': authorize(args.token); return scanContent(true);
    case 'setEntryVisibility': {
      authorize(args.token); entryFor(args.id);
      state.entries = state.entries.map(entry => entry.id === args.id ? { ...entry, hidden: !!args.hidden } : entry);
      save(); return true;
    }
    case 'removeEntry': case 'restoreEntry': {
      authorize(args.token); entryFor(args.id);
      state.entries = state.entries.map(entry => entry.id === args.id ? { ...entry, removed: method === 'removeEntry', removedAt: method === 'removeEntry' ? Date.now() : 0 } : entry);
      save(); return true;
    }
    case 'clearStaleEntries': {
      authorize(args.token);
      if (!['local', 'baidu'].includes(args.source) || !Array.isArray(args.ids) || !args.ids.length || args.ids.length > 1024) throw new Error('请重新选择需要清理的入口。');
      const eligible = new Set(staleEntries(state.entries, args.source).map(entry => entry.id)), ids = new Set(args.ids);
      if ([...ids].some(id => !eligible.has(id))) throw new Error('目录范围已变化，请重新确认要清理的入口。');
      state.entries = state.entries.map(entry => ids.has(entry.id) ? { ...entry, removed: true, removedAt: Date.now() } : entry);
      save(); return ids.size;
    }
    case 'bonus': authorize(args.token); state.usage.extraMs += 5 * 60000; state.usage.sessionMs = 0;
      state.usage.restUntil = 0; save(); return true;
    case 'setLearning': {
      if (args.active && availability(state.usage, state.settings).reason) throw new Error('现在是休息时间。');
      learning = !!args.active; tick(); return true;
    }
    case 'setPlaybackMode': {
      if (!PLAYBACK_MODES.includes(args.mode)) throw new Error('请选择有效的播放模式。');
      seriesFor(childEntry(args.entryId)).mode = args.mode; save(); return true;
    }
    case 'recordPlaybackTime': {
      const entry = entryFor(args.entryId, args.path);
      const stats = state.playbackStats[entry.id] ||= freshPlaybackStats();
      const item = seriesFor(entry).items[args.path];
      if (item && ['video', 'audio'].includes(mediaKind(args.path))) recordGameWatch(item, args.elapsedMs);
      addPlaybackTime(stats, mediaKind(args.path), args.elapsedMs); save(); return true;
    }
    case 'setGameRounds': {
      authorize(args.token); entryFor(args.entryId);
      state.gameSettings[args.entryId] = { rounds: gameRounds(args.rounds) }; save(); return true;
    }
    case 'startGame': {
      entryFor(args.entryId);
      if (args.preview) authorize(args.token);
      else {
        childEntry(args.entryId);
        if (!(await gameStatuses())[args.entryId]?.unlocked) throw new Error('Complete the series to unlock this game.');
        if (availability(state.usage, state.settings).reason) throw new Error('It is time for a break.');
      }
      gameSession = { entryId: args.entryId, preview: !!args.preview }; learning = !args.preview; tick(); return true;
    }
    case 'speakGame': {
      stopGameAudio();
      if (!gameSession || document.hidden || (!gameSession.preview && availability(state.usage, state.settings).reason)) return 'cancelled';
      const ids = new Set([...Object.keys(gameContent.questions), ...Object.values(gameContent.questions).map(q => `yes-${q.answer}`),
        ...Object.keys(gameContent.wrongFeedback || {}).map(id => `wrong-${id}`), 'try-again', 'all-done']);
      if (!ids.has(args.id)) return 'error';
      return gameSpeech.play(`game-audio/${args.id}.m4a`);
    }
    case 'getGameProgress':
    case 'saveGameProgress': {
      if (!gameSession || gameSession.entryId !== args.entryId) throw new Error('Please open the game again.');
      const entry = entryFor(args.entryId), key = `${entry.id}:${entry.path}`;
      if (gameSession.preview) return { revision: 0, progress: null };
      childEntry(entry.id);
      const previous = state.gameProgress[key] || { revision: 0, progress: null };
      if (method === 'getGameProgress') return JSON.parse(JSON.stringify(previous));
      if (args.expectedRevision !== previous.revision) {
        if (JSON.stringify(args.progress) === JSON.stringify(previous.progress)) return JSON.parse(JSON.stringify(previous));
        throw new Error('Your saved game changed. Please open the game again.');
      }
      if (!validGameTransition(entry, previous.progress, args.progress)) throw new Error('Invalid game progress.');
      const next = { revision: previous.revision + 1, progress: JSON.parse(JSON.stringify(args.progress)) };
      state.gameProgress[key] = next;
      try { save(); } catch (error) { state.gameProgress[key] = previous; throw error; }
      return JSON.parse(JSON.stringify(next));
    }
    case 'stopGameAudio': stopGameAudio(); return true;
    case 'endGame': stopGameAudio(); gameSession = null; learning = false; tick(); return true;
    case 'resetPlaybackTime': {
      authorize(args.token); const entry = entryFor(args.entryId);
      state.playbackStats[entry.id] = { ...freshPlaybackStats(), resetAt: Date.now() }; save(); return true;
    }
    case 'planPlayback': {
      const entry = childEntry(args.entryId), series = seriesFor(entry);
      const files = (await fileRecords()).filter(file => ['video', 'audio'].includes(file.kind) &&
        (entry.kind === 'folder' ? isWithin(file.path, entry.path) : file.path === entry.path))
        .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
      const selection = selectPlayback(files.map(file => file.path), series, undefined, args.restart !== false);
      const file = files.find(file => file.path === selection.path);
      save();
      return { ...selection, episodes: files.map(({ path, name, kind }) => ({ path, name, kind })), mode: series.mode, name: file?.name, kind: file?.kind,
        positionMs: series.items[selection.path]?.positionMs || 0 };
    }
    case 'startPlayback': {
      const entry = childEntry(args.entryId, args.path);
      const series = seriesFor(entry); startPlayback(series, args.path);
      if (args.reset) series.items[args.path].positionMs = 0;
      entry.lastPlayedPath = args.path; entry.lastPlayedAt = Date.now(); save(); return true;
    }
    case 'savePlayback': {
      progressPlayback(seriesFor(entryFor(args.entryId, args.path)), args.path, args.positionMs, args.durationMs); save(); return true;
    }
    case 'completePlayback': {
      const series = seriesFor(entryFor(args.entryId, args.path)), item = series.items[args.path];
      if (item) finishGameWatch(item);
      completePlayback(series, args.path); save(); return true;
    }
    case 'getRoots': {
      authorize(args.token); const records = await fileRecords(); const rootNames = new Set(['/demo']);
      for (const file of records) if (!file.builtin) rootNames.add(`/${file.path.split('/')[1]}`);
      return [...rootNames].map(path => ({ path, name: path === '/demo' ? '内置示例' : path.slice(1), kind: 'folder' }));
    }
    case 'list': {
      allowedPath(args.path, args.token); const records = await fileRecords(); const prefix = `${args.path.replace(/\/$/, '')}/`;
      const children = new Map();
      for (const file of records) {
        if (!file.path.startsWith(prefix)) continue;
        const remainder = file.path.slice(prefix.length), slash = remainder.indexOf('/');
        if (slash >= 0) { const name = remainder.slice(0, slash); children.set(name, { name, path: prefix + name, kind: 'folder' }); }
        else children.set(file.name, { ...file, src: file.preview && file.kind !== 'image' ? undefined : file.src, blob: undefined });
      }
      return { path: args.path, items: naturalSort([...children.values()]), truncated: false };
    }
    case 'resolveMedia': {
      allowedPath(args.path, args.token); const file = (await fileRecords()).find(f => f.path === args.path);
      if (!file) throw new Error('找不到这个文件，请重新连接存储设备。');
      const series = args.entryId ? seriesFor(entryFor(args.entryId, args.path)) : null;
      return { ...file, blob: undefined, positionMs: series?.items[file.path]?.positionMs || 0,
        src: file.builtin || file.preview ? file.src : URL.createObjectURL(file.blob) };
    }
    default: throw new Error(`浏览器暂不支持 ${method}`);
  }
}
let seq = 0;
const pending = new Map();
window.__pipiResolve = (id, value, error) => {
  const request = pending.get(id); if (!request) return;
  clearTimeout(request.timeout); pending.delete(id);
  if (error) request.reject(new Error(error)); else request.resolve(value);
};
export function call(method, args = {}) {
  if (!isNative) return browserCall(method, args);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('电视暂时没有响应，请重试。')); }, method === 'editText' ? 10 * 60000 : method.startsWith('baidu') ? 90000 : 30000);
    pending.set(id, { resolve, reject, timeout });
    try { window.PipiTV.request(JSON.stringify({ id, method, args })); }
    catch (e) { clearTimeout(timeout); pending.delete(id); reject(e); }
  });
}
export async function importFiles(files, token) {
  authorize(token); const all = Array.from(files); if (!all.length) throw new Error('没有选择文件。');
  const first = all[0]; const folderName = first.webkitRelativePath?.split('/')[0];
  const root = folderName || `导入内容-${Date.now()}`;
  const records = all.filter(file => mediaKind(file.name)).map(file => ({
    path: `/${file.webkitRelativePath || `${root}/${file.name}`}`, name: file.name,
    kind: mediaKind(file.name), size: file.size, mime: file.type, blob: file,
  }));
  if (!records.length) throw new Error('文件夹里还没有视频、音频、图片或 PDF。');
  const handle = await db();
  await new Promise((resolve, reject) => {
    const tx = handle.transaction('files', 'readwrite');
    for (const record of records) tx.objectStore('files').put(record);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); handle.close();
  return all.length === 1 && !first.webkitRelativePath
    ? { path: records[0].path, name: first.name, kind: records[0].kind, count: 1 }
    : { path: `/${root}`, name: root, kind: 'folder', count: records.length };
}
