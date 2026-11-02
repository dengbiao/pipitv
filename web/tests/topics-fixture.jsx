// Development-only real-media acceptance, isolated from saved preview and TV data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import '../src/styles.css';

if (location.port !== '4198') throw new Error('内容标签验收只能在隔离端口 4198 运行。');
const response = await fetch('/__tv-preview/catalog');
if (!response.ok) throw new Error('无法读取真实电视媒体清单。');
const catalog = await response.json();
window.__PIPI_PREVIEW_CATALOG__ = catalog;
localStorage.setItem('pipikids-v1', JSON.stringify({
  entries: catalog.entries.map(entry => ({ ...entry, mediaCover: false })),
  scanRoots: ['/storage/4A21-0000'],
  settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24, dailyMinutes: 180, sessionMinutes: 60 },
  usage: freshUsage(), playback: {}, playbackStats: {}, pinHash: '', pinSalt: '', failures: 0, lockUntil: 0,
}));
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<App />);
