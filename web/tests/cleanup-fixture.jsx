// Disposable UI data, excluded from the APK. No original files are accessed.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogCleanup } from '../src/CatalogCleanup.jsx';
import { FocusButton } from '../src/RemoteControls.jsx';
import { useRemoteNavigation } from '../src/remoteNavigation.js';
import '../src/styles.css';
import '../src/parent.css';
if (location.port !== '4198') throw new Error('Cleanup fixture requires port 4198.');
const seed = [{ id: 'kept', title: '当前系列', path: '/storage/USB/Current', kind: 'folder', mediaCount: 12, available: true },
  { id: 'old', title: '之前误加的目录', path: '/storage/Old', kind: 'folder', mediaCount: 104, available: false, catalogReason: 'out_of_scope' }];
function Fixture() {
  const [entries, setEntries] = useState(seed), [target, setTarget] = useState(null), [message, setMessage] = useState('');
  useRemoteNavigation(() => {});
  const request = async (method, args) => {
    if (method === 'removeEntry' || method === 'restoreEntry') setEntries(current => current.map(entry => entry.id === args.id ? { ...entry, removed: method === 'removeEntry', removedAt: Date.now() } : entry));
    else if (method === 'clearStaleEntries') setEntries(current => current.map(entry => args.ids.includes(entry.id) && entry.catalogReason === 'out_of_scope' ? { ...entry, removed: true, removedAt: Date.now() } : entry));
    else throw new Error('Unknown fixture action');
    return true;
  };
  return <main className="parent-page page" data-focus-scope="active" data-focus-key="cleanup-fixture"><header className="page-header"><div><span className="eyebrow">ISOLATED QA · 模拟内容</span><h1>家长空间 · 入口整理</h1></div></header>
    <div className="parent-content"><div className="content-source-bar"><div className="content-source-switch"><FocusButton className="source-button selected">本地内容</FocusButton></div>
      <div className="catalog-controls" /><CatalogCleanup entries={entries} source="local" token="fixture" request={request} refresh={async () => {}} notify={setMessage} removeTarget={target} onRemoveClose={() => setTarget(null)} /></div>
      <div className="entry-list">{entries.filter(entry => !entry.removed).map(entry => <div className="entry-row" key={entry.id}><div className="entry-row-name"><strong>{entry.title}</strong><small>{entry.path}</small><small>{entry.mediaCount} 项内容</small></div>
        <div className="entry-row-actions"><FocusButton className="secondary" focusId={`edit:${entry.id}`}>编辑</FocusButton><FocusButton className="secondary" focusId={`delete:${entry.id}`} onClick={() => setTarget(entry)} aria-label={`删除 ${entry.title}`}>删除</FocusButton></div></div>)}</div>
      {message && <p role="status">{message}</p>}</div></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
