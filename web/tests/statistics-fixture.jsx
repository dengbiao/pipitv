// Local QA only. Dedicated origin, disposable media/state, documented test PIN 2468.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import sampleUrl from '../../outputs/qa/timer-test.mp4?url';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import '../src/styles.css';

if (location.port !== '4187') throw new Error('统计验证只能在隔离端口 4187 运行。');
const sample = await (await fetch(sampleUrl)).blob();
await new Promise((resolve, reject) => {
  const request = indexedDB.open('pipikids-files', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction('files', 'readwrite');
    for (const root of ['english', 'wow', 'other']) for (const name of ['01 Hello.mp4', '02 Goodbye.mp4'])
      tx.objectStore('files').put({ path: `/stats-${root}/${name}`, name, kind: 'video', size: sample.size, blob: sample });
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
  };
});
if (!localStorage.getItem('pipikids-v1')) {
  const salt = new Uint8Array(16).fill(7);
  const hash = await pbkdf2Async(sha256, new TextEncoder().encode('2468'), salt, { c: 100000, dkLen: 32 });
  const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('pipikids-v1', JSON.stringify({
    entries: [
      { id: 'english', title: '古力小超人', path: '/stats-english', kind: 'folder', cover: 'animals', language: 'en' },
      { id: 'wow', title: 'WOW English', path: '/stats-wow', kind: 'folder', cover: 'colors', language: 'en' },
      { id: 'other', title: '其他语言系列', path: '/stats-other', kind: 'folder', cover: 'songs', language: 'other' },
    ],
    playbackStats: { english: { totalMs: 3723000, videoMs: 3600000, resetAt: 0 }, wow: { totalMs: 63000, videoMs: 63000, resetAt: 0 }, other: { totalMs: 11000, videoMs: 11000, resetAt: 0 } },
    settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 }, usage: freshUsage(), pinHash: hex(hash), pinSalt: hex(salt), pinLength: 4, failures: 0, lockUntil: 0,
  }));
}
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
