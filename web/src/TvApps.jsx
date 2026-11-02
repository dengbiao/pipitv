import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, Check, Plus, SquaresFour, ShieldCheck, ShieldPlus } from '@phosphor-icons/react';
import { call } from './bridge.js';
import { FocusButton } from './RemoteControls.jsx';
import './tv-apps.css';

export function AppIcon({ app }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [app.icon]);
  return <span className="tv-app-icon" aria-hidden="true">{app.icon && !failed
    ? <img src={app.icon} alt="" onError={() => setFailed(true)} />
    : <SquaresFour weight="duotone" />}</span>;
}

export function TvAppShelf({ apps, onOpen, autoFocus = false, busy }) {
  const available = (apps || []).filter(app => app.available !== false);
  if (!available.length) return null;
  return <section className="tv-app-shelf" aria-labelledby="tv-app-shelf-title">
    <h2 id="tv-app-shelf-title">电视应用</h2>
    <div className="tv-app-shortcuts" data-focus-row>
      {available.map((app, index) => <FocusButton key={app.packageName} className="tv-app-shortcut"
        focusId={`tv-app:${app.packageName}`} data-autofocus={autoFocus && index === 0 ? 'true' : undefined}
        aria-label={`打开 ${app.label}`} aria-disabled={busy || undefined} onClick={() => onOpen(app)}>
        <AppIcon app={app} /><span>{app.label}</span>
      </FocusButton>)}
    </div>
  </section>;
}

export function TvAppSettings({ token, control, onChange, notify }) {
  const [catalog, setCatalog] = useState(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false), version = useRef(0);
  const load = useCallback(async () => {
    if (busy.current) return;
    const request = ++version.current;
    setLoading(true); setMessage('');
    try { const result = await call('listTvApps', { token }); if (request === version.current) setCatalog(result); }
    catch (error) { if (request === version.current) setMessage(error.message); }
    finally { if (request === version.current) setLoading(false); }
  }, [token]);
  useEffect(() => { load(); return () => { version.current++; }; }, [load]);
  const toggle = async (app, field = 'selected') => {
    if (busy.current || loading) return;
    busy.current = true; setSaving(`${field}:${app.packageName}`);
    const request = ++version.current;
    try {
      const result = await onChange(app.packageName, !app[field], field);
      if (request === version.current) setCatalog(previous => {
        // Keep the focused row in place when the native list groups selected apps first.
        const remaining = new Map(result.apps.map(app => [app.packageName, app])), apps = [];
        for (const old of previous?.apps || []) {
          if (remaining.has(old.packageName)) apps.push(remaining.get(old.packageName));
          remaining.delete(old.packageName);
        }
        return { ...result, apps: [...apps, ...remaining.values()] };
      });
    } catch (error) { notify(error.message); }
    finally { busy.current = false; if (request === version.current) setSaving(''); }
  };
  const status = control || catalog?.control;
  const openPermissions = async () => {
    if (busy.current || loading) return;
    try { await call('openAppControlSettings', { token }); }
    catch (error) { notify(error.message); }
  };
  return <div className="tv-app-settings">
    <div className="section-heading"><div><h2>应用入口与使用管控</h2>
      <p>按 OK 设置首页显示或加入管控，选择后自动保存。</p></div>
      <FocusButton className="secondary" focusId="refresh-tv-apps" data-autofocus
        aria-disabled={loading || !!saving} onClick={() => { if (!loading) load(); }}><ArrowCounterClockwise />刷新应用</FocusButton></div>
    <p className="tv-app-scope-note">受控应用共用每日上限、单次上限、休息间隔和可用时段；未加入的应用不限时。</p>
    {catalog?.supported && <div className="tv-app-control-setup"><div><strong>{status?.ready ? '应用管控已开启' : status?.enabled ? '应用管控正在启动…' : '开启应用管控权限'}</strong>
      <p>{status?.ready ? status?.limitsSuspended ? '当前调试不限时，恢复整体限制后执行。' : '按前台使用时间计时，到时返回休息页。' : '在系统中开启「PIPI 应用管控」后生效。仅识别前台应用，不读取页面内容。'}</p></div>
      <FocusButton className="secondary" focusId="app-control-permission" aria-disabled={!!saving} onClick={openPermissions}>
        <ShieldCheck />{status?.ready ? '系统权限' : '去开启'}</FocusButton></div>}
    {loading ? <p className="quiet-message" role="status">正在读取电视应用…</p>
      : message ? <p className="quiet-message" role="status">{message}</p>
      : !catalog?.supported ? <p className="quiet-message">请在电视上的 PIPI KIDS 中选择应用。浏览器无法读取或打开电视里安装的应用。</p>
      : <>
        <p className="tv-app-count">{catalog.apps.filter(app => app.selected && app.available !== false).length} 个应用显示在首页</p>
        <div className="tv-app-list" data-focus-grid>{catalog.apps.map(app => <div className={`tv-app-row ${app.available === false ? 'tv-app-unavailable' : ''}`} key={app.packageName}>
          <AppIcon app={app} /><div className="tv-app-copy"><strong>{app.label}</strong>
            <span>{app.available === false ? '已卸载或已停用 · 首页暂不显示' : app.selected ? '首页显示' : '未添加到首页'} · {app.managed ? status?.ready ? '遵循整体管控' : '待开启管控权限' : '不限时'}</span></div>
          <div className="tv-app-row-actions" data-focus-row>
          <FocusButton className={`secondary tv-app-toggle ${app.selected ? 'is-selected' : ''}`}
            focusId={`choose-tv-app:${app.packageName}`} aria-pressed={app.selected} aria-disabled={!!saving}
            aria-label={`${app.selected ? '从首页移除' : '添加到首页'} ${app.label}`} onClick={() => toggle(app)}>
            {app.selected ? <Check /> : <Plus />}{saving === `selected:${app.packageName}` ? '正在保存…' : app.selected ? '已添加' : '添加到首页'}
          </FocusButton>
          <FocusButton className={`secondary tv-app-toggle ${app.managed ? 'is-selected' : ''}`}
            focusId={`manage-tv-app:${app.packageName}`} aria-pressed={!!app.managed} aria-disabled={!!saving}
            aria-label={`${app.managed ? '取消管控' : '加入管控'} ${app.label}`} onClick={() => toggle(app, 'managed')}>
            {app.managed ? <ShieldCheck /> : <ShieldPlus />}{saving === `managed:${app.packageName}` ? '正在保存…' : app.managed ? '已加入管控' : '加入管控'}
          </FocusButton></div>
        </div>)}</div>
        {!catalog.apps.length && <p className="quiet-message">还没有找到可打开的应用，安装后可刷新列表。</p>}
      </>}
  </div>;
}
