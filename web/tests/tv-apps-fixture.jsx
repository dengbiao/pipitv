// Disposable browser QA only. This entry is never bundled in the APK.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import '../src/styles.css';

if (location.port !== '4196') throw new Error('TV app QA requires isolated port 4196.');
window.__PIPI_PREVIEW_APPS__ = [
  { packageName: 'fixture.music', label: '音乐应用示例', icon: 'art/songs.png' },
  { packageName: 'fixture.tv', label: '电视应用示例', icon: 'art/colors.png' },
  { packageName: 'fixture.game', label: '游戏应用示例', icon: 'art/animals.png' },
  ...Array.from({ length: 7 }, (_, i) => ({ packageName: `fixture.extra${i}`, label: `应用示例 ${i + 1}` })),
];
const controlEnabled = new URLSearchParams(location.search).get('control') === 'on';
window.__PIPI_PREVIEW_APP_CONTROL__ = { enabled: controlEnabled, ready: controlEnabled, limitsSuspended: controlEnabled };
if (!localStorage.getItem('pipikids-v1')) {
  const salt = new Uint8Array(16).fill(17), hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  const hash = await pbkdf2Async(sha256, new TextEncoder().encode('2468'), salt, { c: 100000, dkLen: 32 });
  localStorage.setItem('pipikids-v1', JSON.stringify({ settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 },
    usage: freshUsage(), pinHash: hex(hash), pinSalt: hex(salt), pinLength: 4 }));
}
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
