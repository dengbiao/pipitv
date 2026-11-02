// Development-only entry point, never included in the production Vite input/APK.
// All state is disposable memory. No real PIN, bridge, storage, media or TV is accessed.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { normalizeScanPaths, withinScanPath } from '../src/content-catalog.js';

let pinSet = new URLSearchParams(location.search).get('mode') !== 'setup';
let entries = ['古力小超人', 'WOW 第1周', 'WOW 第2周'].map((title, index) => ({
  id: `fixture-${index}`, title, subtitle: '隔离验证内容', path: `/fixture/${index}`, kind: 'folder', cover: ['animals', 'colors', 'songs'][index],
}));
let settings = { dailyMinutes: 60, sessionMinutes: 20, restMinutes: 5, startHour: 8, endHour: 21, chinese: true };
let scanPaths = ['/fixture'];
const catalog = () => ({ roots: scanPaths.map(path => ({ path, name: path === '/fixture' ? '模拟 U 盘' : path.split('/').at(-1), available: true })), complete: true, configured: true, scannedAt: Date.now() });
const operations = {};
const roots = [{ path: '/fixture', name: '模拟 U 盘', kind: 'folder' }];
const folders = {
  '/fixture': entries.map(entry => ({ path: entry.path, name: entry.title, kind: 'folder' })),
  '/fixture/0': Array.from({ length: 30 }, (_, index) => ({ path: `/fixture/0/${index}`, name: `内容 ${String(index + 1).padStart(2, '0')}`, kind: 'folder' })),
  '/fixture/1': [{ path: '/fixture/1/child', name: '子文件夹', kind: 'folder' }],
  '/fixture/1/child': [], '/fixture/2': [],
};
window.PipiTV = {
  focusChanged(label) { document.body.dataset.fixtureFocus = label; },
  request(raw) {
    const { id, method, args } = JSON.parse(raw);
    operations[method] = (operations[method] || 0) + 1;
    const resolve = (result, error = null) => setTimeout(() => window.__pipiResolve(id, result, error), method === 'list' ? 40 : 0);
    switch (method) {
      case 'getState': resolve({ entries, catalog: catalog(), settings, usage: { usedMs: 0 }, access: { reason: '', remainingMs: 3600000, dailyRemainingMs: 3600000 }, pinSet, pinLength: pinSet ? 4 : 0, native: true, device: '隔离验证 · 无持久化' }); break;
      case 'discardParent': resolve(true); break;
      case 'baiduStatus': resolve({ supported: false, connected: false, syncing: false }); break;
      case 'baiduCancel': resolve(true); break;
      case 'unlock':
        // This fixed test challenge is unrelated to the user's PIN. Never persist it.
        if (args.pin !== '2580') resolve(null, '测试错误：请继续使用屏幕键盘。');
        else { pinSet = true; resolve({ token: 'fixture-only' }); }
        break;
      case 'getRoots': resolve(roots); break;
      case 'list': resolve({ items: folders[args.path] || [] }); break;
      case 'saveSettings': settings = args.settings; resolve(true); break;
      case 'saveEntry': entries = entries.map(entry => entry.id === args.entry.id ? args.entry : entry); resolve(args.entry); break;
      case 'setEntryVisibility': entries = entries.map(entry => entry.id === args.id ? { ...entry, hidden: !!args.hidden } : entry); resolve(true); break;
      case 'saveScanRoots': scanPaths = normalizeScanPaths(args.paths); entries = entries.map(entry => ({ ...entry, available: scanPaths.some(path => withinScanPath(entry.path, path)) })); resolve(catalog()); break;
      case 'scanContent': resolve(catalog()); break;
      case 'setLearning': case 'leaveParent': case 'requestStorage': resolve(true); break;
      default: resolve(null, '隔离验证不会调用此操作。');
    }
    document.body.dataset.fixtureOperations = JSON.stringify(operations);
  },
};
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
