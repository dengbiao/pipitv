// Development-only, disposable browser data. Never touch the main preview's storage.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, freshUsage } from '../src/logic.js';
import { dailyRestReminder, restReminderSource } from '../src/rest-reminders.js';
import '../src/styles.css';

if (location.port !== '4188') throw new Error('休息提醒验证只能在隔离端口 4188 运行。');
const mode = new URLSearchParams(location.search).get('mode') || 'session';
const usage = freshUsage();
usage.usedMs = mode === 'daily' ? 5 * 60000 - 3000 : 57000;
usage.sessionMs = mode === 'daily' ? 0 : 57000;
if (mode === 'blocked') usage.restUntil = Date.now() + 60000;
localStorage.setItem('pipikids-v1', JSON.stringify({
  settings: { ...DEFAULT_SETTINGS, startHour: 0, endHour: 24, sessionMinutes: 1, dailyMinutes: 5 },
  usage, pinHash: '', pinSalt: '', failures: 0, lockUntil: 0,
}));
const expected = dailyRestReminder();
const results = { mode, starts: 0, ended: 0, pauses: 0, errors: 0, id: expected.id, expected: expected.text, matched: false };
const diagnostics = document.createElement('pre'); diagnostics.id = 'rest-qa';
diagnostics.style.cssText = 'position:fixed;bottom:0;left:0;z-index:1000;background:#fff;padding:8px;font:12px monospace;max-width:100vw;white-space:pre-wrap';
document.body.appendChild(diagnostics);
const update = () => { diagnostics.textContent = JSON.stringify(results); };
update();
const OriginalAudio = window.Audio;
window.Audio = function (source) {
  const audio = new OriginalAudio(source);
  audio.addEventListener('playing', () => {
    results.starts++;
    results.matched = source === restReminderSource(expected) && document.querySelector('[data-rest-reminder]')?.textContent === expected.text;
    update();
  });
  audio.addEventListener('ended', () => { results.ended++; update(); });
  audio.addEventListener('pause', () => { results.pauses++; update(); });
  audio.addEventListener('error', () => { results.errors++; update(); });
  return audio;
};
const { App } = await import('../src/App.jsx');
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
