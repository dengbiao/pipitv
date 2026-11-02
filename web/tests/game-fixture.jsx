// Browser preview of the real TV USB, with independent browser progress/PIN.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import '../src/styles.css';

if (location.port !== '4191') throw new Error('TV preview requires isolated port 4191.');
const response = await fetch('/__tv-preview/catalog');
if (!response.ok) throw new Error('The TV USB catalog is unavailable.');
const catalog = await response.json();
window.__PIPI_PREVIEW_CATALOG__ = catalog;
let previewState;
try { previewState = JSON.parse(localStorage.getItem('pipikids-v1')); } catch { /* Recover a partial preview save. */ }
previewState ||= { settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24 }, usage: freshUsage() };
// Replace the old two-sample demo once. Later parent choices stay intact.
if (previewState.previewCatalogVersion !== catalog.version) {
  previewState = { ...previewState, entries: catalog.entries.map(entry => ({ ...entry, mediaCover: false })), previewCatalogVersion: catalog.version,
    gameSettings: { ...previewState.gameSettings, ...Object.fromEntries(catalog.entries.map(entry => [entry.id, { rounds: 0 }])) } };
}
if (!previewState.pinHash) {
  const salt = new Uint8Array(16).fill(9), hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  const hash = await pbkdf2Async(sha256, new TextEncoder().encode('2468'), salt, { c: 100000, dkLen: 32 });
  previewState = { ...previewState, pinHash: hex(hash), pinSalt: hex(salt), pinLength: 4 };
}
localStorage.setItem('pipikids-v1', JSON.stringify(previewState));
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<><App /><span style={{position:'fixed',bottom:6,left:10,fontSize:11,color:'#617158',zIndex:56,pointerEvents:'none'}}>TV USB preview · Browser progress is separate</span></>);
