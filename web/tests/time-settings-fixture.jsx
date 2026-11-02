// Disposable QA origin. Never included in the production index or TV APK.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import '../src/styles.css';

if (location.port !== '4193') throw new Error('Time settings QA requires isolated port 4193.');
if (!localStorage.getItem('pipikids-v1')) {
  const salt = new Uint8Array(16).fill(13), hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  const hash = await pbkdf2Async(sha256, new TextEncoder().encode('2468'), salt, { c: 100000, dkLen: 32 });
  localStorage.setItem('pipikids-v1', JSON.stringify({ settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 },
    usage: freshUsage(), pinHash: hex(hash), pinSalt: hex(salt), pinLength: 4 }));
}
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
