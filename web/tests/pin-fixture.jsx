// Disposable component fixture. No production bridge, browser storage or TV is accessed.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FocusButton, ParentGate } from '../src/RemoteControls.jsx';
import { useRemoteNavigation } from '../src/remoteNavigation.js';
import '../src/styles.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';

const mode = new URLSearchParams(location.search).get('mode') || 'setup';
let pinSet = mode !== 'setup', pinLength = mode === 'legacy' ? 0 : pinSet ? 4 : 0;
let testPin = mode === 'legacy' ? '24682468' : '2468', granted = false;
const counts = { authenticate: 0, change: 0, discard: 0, success: 0 };
const record = () => { document.body.dataset.pinFixture = JSON.stringify({ ...counts, pinLength }); };
const wait = () => new Promise(resolve => setTimeout(resolve, 90));
function Fixture() {
  const [open, setOpen] = useState(false), [unlocked, setUnlocked] = useState(false);
  useRemoteNavigation(() => setOpen(false));
  return <main className="app" style={{ background: '#e2e8d9', minHeight: '100vh', padding: 50 }}>
    <section data-focus-scope="active" data-focus-key="pin-fixture">
      <h1>{unlocked ? '模拟家长空间' : '四位 PIN 隔离验收'}</h1>
      <p style={{ margin: '20px 0' }}>只使用一次性内存数据，不接触真实 PIN。</p>
      <FocusButton className="primary" data-autofocus onClick={() => { setUnlocked(false); setOpen(true); }}>打开家长验证</FocusButton>
    </section>
    {open && <ParentGate pinSet={pinSet} pinLength={pinLength} onClose={() => setOpen(false)}
      onAuthenticate={async pin => {
        counts.authenticate++; record(); await wait();
        if (pinSet && pin !== testPin) throw new Error('PIN 不正确，请再试一次。');
        if (!pinSet) { testPin = pin; pinSet = true; pinLength = 4; }
        granted = true; record(); return { token: 'fixture-only-token' };
      }}
      onChangePin={async (token, pin) => {
        counts.change++; record(); await wait();
        if (!granted || token !== 'fixture-only-token') throw new Error('家长验证已过期。');
        testPin = pin; pinLength = 4; record(); return { token };
      }}
      onDiscardToken={() => { granted = false; counts.discard++; record(); }}
      onUnlock={() => { counts.success++; record(); setOpen(false); setUnlocked(true); }} />}
  </main>;
}
record(); createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
