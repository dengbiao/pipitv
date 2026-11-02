// Disposable UI fixture. No real accounts, authorization or cloud content are used.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BaiduSettings } from '../src/BaiduSettings.jsx';
import { useRemoteNavigation } from '../src/remoteNavigation.js';
import '../src/styles.css';
import '../src/parent.css';
if (location.port !== '4197') throw new Error('Baidu QA requires isolated port 4197.');
const params = new URLSearchParams(location.search), expired = params.has('expired');
let connected = params.has('connected'), syncing = false, selected = '', calls = 0, scanned = 0;
const request = async (method, args = {}) => {
  if (method === 'baiduStatus') return { supported: true, connected, syncing, scanned, selectedFolder: selected, lastSync: selected ? Date.now() : 0, seriesCount: selected ? 2 : 0 };
  if (method === 'baiduStart') { calls = 0; return { id: 'fixture-only', qrSrc: 'art/logo.png', userCode: 'QA-ONLY', expiresAt: Date.now() + (expired ? 2000 : 300000), interval: 10 }; }
  if (method === 'baiduCancel') return true;
  if (method === 'baiduPoll') { if (++calls >= 1) { connected = true; return { state: 'connected' }; } return { state: 'pending', interval: 10 }; }
  if (method === 'baiduFolders') return { path: args.path, items: args.path === '/apps/皮皮课堂' ? [{ id: 101, path: '/apps/皮皮课堂/英语启蒙', name: '英语启蒙' }, { id: 102, path: '/apps/皮皮课堂/晚安故事', name: '晚安故事' }] : [] };
  if (method === 'baiduSelect' || method === 'baiduSync') {
    syncing = true; selected = (args.folder?.path || '/apps/皮皮课堂/英语启蒙').replace('/apps', '/我的应用数据');
    setTimeout(() => { syncing = false; scanned = 38; }, 1000);
    return request('baiduStatus');
  }
  if (method === 'baiduDisconnect') { connected = false; selected = ''; return true; }
  throw new Error('Unsupported fixture request');
};
const refresh = async () => {}, notify = () => {};
function Fixture() {
  useRemoteNavigation(() => {});
  return <main className="parent-page page"><header className="page-header"><div><span className="eyebrow">ISOLATED QA</span><h1>家长空间 · 网盘界面验证</h1></div></header>
    <div className="parent-content"><p className="catalog-summary">模拟授权，仅用于界面验证。此页不会连接真实账号。</p><BaiduSettings token="fixture" available request={request} refresh={refresh} notify={notify} /></div></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
