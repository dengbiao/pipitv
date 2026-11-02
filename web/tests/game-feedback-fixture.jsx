// Isolated visual/audio QA of the production game, available outside child hours.
// No catalog, settings, PIN, usage or viewing history is written by this fixture.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createGameSpeechPlayer } from '../src/game-speech.js';
import { gameContent } from '../src/games.js';
import { useRemoteNavigation } from '../src/remoteNavigation.js';
import '../src/styles.css';

const speech = createGameSpeechPlayer();
const allowed = new Set([...Object.keys(gameContent.questions), ...Object.values(gameContent.questions).map(question => `yes-${question.answer}`),
  ...Object.keys(gameContent.wrongFeedback).map(id => `wrong-${id}`), 'try-again', 'all-done']);
// Use the normal native-bridge protocol in memory; no production parent gate is bypassed.
window.PipiTV = { request(raw) {
  const { id, method, args } = JSON.parse(raw);
  Promise.resolve().then(() => {
    if (method === 'speakGame') return allowed.has(args.id) ? speech.play(`game-audio/${args.id}.m4a`) : 'error';
    if (method === 'stopGameAudio') { speech.stop(); return true; }
    throw new Error('Unsupported feedback-fixture request.');
  }).then(value => window.__pipiResolve(id, value, null), error => window.__pipiResolve(id, null, error.message));
} };
const { SeriesGame } = await import('../src/SeriesGame.jsx');
function FeedbackPreview() {
  const [entry, setEntry] = useState(null);
  useRemoteNavigation(() => setEntry(null));
  return <main className="app">
    {entry ? <SeriesGame key={entry.id} entry={entry} preview onClose={() => setEntry(null)} />
      : <section data-focus-scope="active" data-focus-key="feedback-preview-menu" style={{ padding: '15vh 8vw', textAlign: 'center' }}>
        <h1>Choose a series</h1>
        <p style={{ margin: '2em 0' }}>Isolated feedback preview · English picture games</p>
        <button className="secondary" data-focusable data-autofocus onClick={() => setEntry({ id: 'feedback-guli', title: '古力小超人' })}>Little Superhero</button>{' '}
        <button className="secondary" data-focusable onClick={() => setEntry({ id: 'feedback-wow', title: 'WOW English' })}>WOW English</button>
      </section>}
    <span style={{ position: 'fixed', bottom: 6, left: 10, zIndex: 56, fontSize: 11, color: '#617158', pointerEvents: 'none' }}>Isolated feedback preview · No viewing history</span>
  </main>;
}
createRoot(document.getElementById('root')).render(<FeedbackPreview />);
