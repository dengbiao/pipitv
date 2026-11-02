// Development-only browser integration fixture. Port isolation keeps real preview data untouched.
import React from 'react';
import { createRoot } from 'react-dom/client';
import sampleUrl from '../../outputs/qa/timer-test.mp4?url';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import { freshSeries } from '../src/playback.js';
import '../src/styles.css';

if (location.port !== '4186') throw new Error('续播验证只能在隔离端口 4186 运行。');
const mode = new URLSearchParams(location.search).get('mode');
const series = freshSeries('/episode-fixture');
if (mode === 'sequential' || mode === 'random') series.mode = mode;
const sample = await (await fetch(sampleUrl)).blob();
const files = ['01 Hello.mp4', '02 Wake up.mp4', '10 Goodbye.mp4'].map(name => ({
  path: `/episode-fixture/${name}`, name, kind: 'video', size: sample.size, blob: sample,
}));
files.push({ path: '/episode-fixture/cover.png', name: 'cover.png', kind: 'image', size: 0, blob: new Blob([]) });
if (mode === 'error') files[1].blob = new Blob(['not a video'], { type: 'video/mp4' });
await new Promise((resolve, reject) => {
  const request = indexedDB.open('pipikids-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').clear();
    files.forEach(file => tx.objectStore('files').put(file));
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
  };
});
const usage = freshUsage();
if (mode === 'limit') usage.usedMs = usage.sessionMs = 48000;
if (mode === 'daily') usage.usedMs = 5 * 60000 - 12000;
localStorage.setItem('pipikids-v1', JSON.stringify({
  entries: [{ id: 'episode-fixture', title: '续播验证', subtitle: '测试视频', path: '/episode-fixture', kind: 'folder', cover: 'animals' }],
  settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24, sessionMinutes: mode === 'limit' ? 1 : 15, dailyMinutes: mode === 'daily' ? 5 : 30 },
  usage, playback: { 'episode-fixture': series }, pinHash: '', pinSalt: '', failures: 0, lockUntil: 0,
}));
document.body.dataset.episodeEvents = '[]';
document.addEventListener('play', event => {
  if (!['VIDEO', 'AUDIO'].includes(event.target.tagName)) return;
  const events = JSON.parse(document.body.dataset.episodeEvents);
  events.push({ player: event.target.closest('[data-focus-key]')?.dataset.focusKey, at: performance.now() });
  document.body.dataset.episodeEvents = JSON.stringify(events);
}, true);
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
