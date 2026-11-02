import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowCounterClockwise, FolderSimple, QrCode, X } from '@phosphor-icons/react';
import { call, isNative } from './bridge.js';
import { FocusButton } from './RemoteControls.jsx';
import { useRemoteBack } from './remoteNavigation.js';
import './baidu.css';

const ROOT = '/apps/皮皮课堂';
const displayPath = path => path.replace(ROOT, '/我的应用数据/皮皮课堂');

export function BaiduSettings({ token, refresh, request = call, available = isNative }) {
  const [state, setState] = useState(null), [flow, setFlow] = useState(null), [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false), [disconnecting, setDisconnecting] = useState(false);
  const [failure, setFailure] = useState(''), [now, setNow] = useState(Date.now());
  const authDialog = useRef(null), confirmDialog = useRef(null), version = useRef(0), active = useRef(true), wasSyncing = useRef(false), connecting = useRef(false);
  const invoke = useCallback((method, args = {}) => request(method, { ...args, token }), [request, token]);
  const load = useCallback(async () => {
    try {
      const next = await invoke('baiduStatus');
      if (!active.current) return;
      setState(next);
      if (wasSyncing.current && !next.syncing) await refresh();
      wasSyncing.current = !!next.syncing;
    } catch (error) { if (active.current) setFailure(error.message); }
  }, [invoke, refresh]);
  useEffect(() => {
    active.current = true; if (available) load();
    const timer = available ? setInterval(load, 2000) : null;
    return () => { active.current = false; version.current++; clearInterval(timer); invoke('baiduCancel').catch(() => {}); };
  }, [available, load, invoke]);
  const cancel = useCallback(() => { version.current++; connecting.current = false; setFlow(null); setExpired(false); setBusy(false); invoke('baiduCancel').catch(() => {}); }, [invoke]);
  useRemoteBack(authDialog, cancel);
  useRemoteBack(confirmDialog, () => setDisconnecting(false));
  const connect = async () => {
    if (connecting.current) return;
    connecting.current = true;
    const current = ++version.current; setBusy(true); setFailure(''); setFlow(null); setExpired(false);
    try {
      const result = await invoke('baiduStart');
      if (current === version.current && active.current) { setNow(Date.now()); setFlow(result); }
    } catch (error) { if (current === version.current && active.current) setFailure(error.message); }
    finally { if (current === version.current && active.current) { connecting.current = false; setBusy(false); } }
  };
  useEffect(() => {
    if (!flow || expired) return;
    let cancelled = false, timer;
    const current = version.current;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= flow.expiresAt) { setExpired(true); return; }
      try {
        const response = await invoke('baiduPoll', { id: flow.id });
        if (cancelled || current !== version.current) return;
        if (response.state === 'connected') { setFlow(null); await load(); await refresh(); setChoosing(true); return; }
        if (response.state === 'expired') { setExpired(true); return; }
        timer = setTimeout(poll, Math.max(10, response.interval || flow.interval || 10) * 1000);
      } catch (error) {
        if (!cancelled) { setFailure(error.message); timer = setTimeout(poll, 15000); }
      }
    };
    timer = setTimeout(poll, Math.max(10, flow.interval || 10) * 1000);
    const clock = setInterval(() => { const time = Date.now(); setNow(time); if (time >= flow.expiresAt) setExpired(true); }, 1000);
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', visibility); };
  }, [flow, expired, invoke, load, refresh, cancel]);
  const sync = async () => {
    setFailure('');
    try { const next = await invoke('baiduSync'); wasSyncing.current = !!next.syncing; setState(next); }
    catch (error) { setFailure(error.message); }
  };
  const disconnect = async () => {
    setBusy(true); setFailure('');
    try { await invoke('baiduDisconnect'); setDisconnecting(false); await load(); await refresh(); }
    catch (error) { setFailure(error.message); }
    finally { setBusy(false); }
  };
  const error = failure || state?.error;
  return <section className={`baidu-settings${state?.connected ? ' is-connected' : ''}`} aria-label="百度网盘">
    {available && <div className="baidu-actions">
      {!state?.connected ? <FocusButton className="primary" focusId="baidu-connect" aria-busy={busy} disabled={state?.supported === false} onClick={connect}><QrCode />{busy ? '正在生成二维码…' : '扫码连接'}</FocusButton> : <>
        <FocusButton className="secondary" focusId="baidu-choose" disabled={state.syncing || busy} onClick={() => setChoosing(true)}><FolderSimple />选择文件夹</FocusButton>
        {!!state.selectedFolder && <FocusButton className="secondary" focusId="baidu-sync" disabled={state.syncing || busy} onClick={sync}><ArrowCounterClockwise />{state.syncing ? '更新中…' : '更新目录'}</FocusButton>}
      </>}
    </div>}
    {state?.connected && <div className="baidu-connection-row">
      {state.selectedFolder && <p className="source-status baidu-selected-folder" title={displayPath(state.selectedFolder)}>{displayPath(state.selectedFolder)}</p>}
      <FocusButton className="text-button" focusId="baidu-disconnect" disabled={state.syncing || busy} onClick={() => setDisconnecting(true)}>断开连接</FocusButton>
    </div>}
    {!available && <p className="source-status">请在电视上扫码连接。</p>}
    {state?.syncing && <p className="source-status" role="status">正在更新目录…</p>}
    {error && <p className="baidu-error" role="alert">{error}</p>}
    {flow && <div className="modal-scrim"><section ref={authDialog} className="baidu-dialog" role="dialog" aria-modal="true" aria-labelledby="baidu-auth-title" data-focus-scope="active" data-focus-key="baidu-auth">
      <header><h2 id="baidu-auth-title">连接百度网盘</h2><FocusButton className="icon-button" aria-label="关闭网盘授权" onClick={cancel}><X /></FocusButton></header>
      <div className="baidu-qr-body"><div className={`baidu-qr ${expired ? 'expired' : ''}`}>
        {!expired && <img src={flow.qrSrc} alt="百度网盘授权二维码" />}
        {expired && <p>二维码已过期</p>}
      </div><div><h3>用手机扫码授权</h3><p>使用百度网盘、百度 App 或手机扫码，确认连接到「皮皮课堂」。</p>
        <p className="baidu-user-code">授权码 <strong>{flow.userCode}</strong></p>
        <small>{expired ? '请刷新二维码后重新扫码。' : `二维码剩余 ${Math.max(0, Math.ceil((flow.expiresAt - now) / 1000))} 秒`}</small>
        <p className="baidu-boundary">仅在「我的应用数据／皮皮课堂」内选择内容。</p>
      </div></div>
      <footer><FocusButton className="secondary" onClick={cancel}>取消</FocusButton><FocusButton className="primary" data-autofocus disabled={busy} onClick={connect}><ArrowCounterClockwise />刷新二维码</FocusButton></footer>
    </section></div>}
    {choosing && <BaiduFolderPicker invoke={invoke} onClose={() => setChoosing(false)} onSelect={async folder => {
      const next = await invoke('baiduSelect', { folder }); wasSyncing.current = !!next.syncing; setState(next); setChoosing(false); setFailure('');
    }} />}
    {disconnecting && <div className="modal-scrim"><section ref={confirmDialog} className="baidu-dialog baidu-confirm" role="dialog" aria-modal="true" aria-labelledby="baidu-disconnect-title" data-focus-scope="active" data-focus-key="baidu-disconnect">
      <h2 id="baidu-disconnect-title">断开百度网盘？</h2><p>移除电视上的授权和网盘缓存。观看记录保留，网盘中的原文件保留。</p>
      <footer><FocusButton className="secondary" data-autofocus disabled={busy} onClick={() => setDisconnecting(false)}>保留连接</FocusButton><FocusButton className="primary" disabled={busy} onClick={disconnect}>断开连接</FocusButton></footer>
    </section></div>}
  </section>;
}

function BaiduFolderPicker({ invoke, onClose, onSelect }) {
  const [stack, setStack] = useState([{ path: ROOT, id: 0, name: '皮皮课堂' }]), [listing, setListing] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), dialog = useRef(null);
  const current = stack[stack.length - 1];
  const back = () => { if (busy) return; if (stack.length > 1) setStack(items => items.slice(0, -1)); else onClose(); };
  useRemoteBack(dialog, back);
  useEffect(() => {
    let cancelled = false; setListing(null); setError('');
    invoke('baiduFolders', { path: current.path }).then(data => { if (!cancelled) setListing(data); }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [current.path, invoke]);
  const choose = async () => { setBusy(true); setError(''); try { await onSelect(current); } catch (error) { setError(error.message); setBusy(false); } };
  return <div className="modal-scrim"><section ref={dialog} className="baidu-dialog baidu-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="baidu-folder-title" data-focus-scope="active" data-focus-loading={!listing && !error ? 'true' : 'false'} data-focus-key={`baidu-folder:${current.path}`}>
    <header><div><h2 id="baidu-folder-title">选择网盘文件夹</h2><p>{displayPath(current.path)}</p></div><FocusButton className="icon-button" aria-label="关闭网盘文件夹选择" disabled={busy} onClick={onClose}><X /></FocusButton></header>
    <p>子文件夹会整理成首页系列；直接放有媒体文件时，当前文件夹作为一个系列。</p>
    <div className="baidu-folder-list">
      {stack.length > 1 && <FocusButton className="baidu-folder" disabled={busy} onClick={back}><ArrowLeft />上一级</FocusButton>}
      {!listing && !error && <p role="status">正在读取文件夹…</p>}
      {listing?.items.map((folder, index) => <FocusButton key={folder.path} className="baidu-folder" disabled={busy} data-autofocus={index === 0 ? 'true' : undefined} onClick={() => setStack(items => [...items, folder])}><FolderSimple /><span>{folder.name}</span></FocusButton>)}
      {listing?.items.length === 0 && <p>没有下一级文件夹，可以直接使用当前文件夹。</p>}
    </div>
    {error && <p className="baidu-error" role="alert">{error}</p>}
    <footer><FocusButton className="secondary" disabled={busy} onClick={onClose}>取消</FocusButton><FocusButton className="primary" data-autofocus={listing?.items.length === 0 ? 'true' : undefined} disabled={busy || !listing} onClick={choose}>{busy ? '正在同步…' : '使用此文件夹'}</FocusButton></footer>
  </section></div>;
}
