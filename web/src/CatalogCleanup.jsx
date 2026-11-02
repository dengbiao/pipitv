import React, { useRef, useState } from 'react';
import { ArrowCounterClockwise, Broom, X } from '@phosphor-icons/react';
import { call } from './bridge.js';
import { FocusButton } from './RemoteControls.jsx';
import { focusRemote, useRemoteBack } from './remoteNavigation.js';
import { sourceEntries, staleEntries } from './content-catalog.js';

function restoreFocus(id) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const element = [...document.querySelectorAll('[data-focus-id]')].find(node => node.dataset.focusId === id);
    if (element) focusRemote(element);
  }));
}

export function CatalogCleanup({ entries, source, token, refresh, notify, removeTarget, onRemoveClose, request = call }) {
  const [open, setOpen] = useState(false), [batch, setBatch] = useState(null), [busy, setBusy] = useState(false);
  const dialog = useRef(null), confirmation = useRef(null);
  const current = sourceEntries(entries, source), stale = staleEntries(entries, source);
  const removed = current.filter(entry => entry.removed).sort((a, b) => (b.removedAt || 0) - (a.removedAt || 0));
  const closeConfirm = () => { if (!busy) { setBatch(null); onRemoveClose(); } };
  useRemoteBack(dialog, () => { if (!busy) setOpen(false); });
  useRemoteBack(confirmation, closeConfirm);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const visible = current.filter(entry => !entry.removed), index = visible.findIndex(entry => entry.id === removeTarget?.id);
    const neighbor = visible[index + 1] || visible[index - 1];
    try {
      if (batch) await request('clearStaleEntries', { token, source, ids: batch.map(entry => entry.id) });
      else await request('removeEntry', { token, id: removeTarget.id });
      await refresh();
      const single = !batch; setBatch(null); onRemoveClose();
      if (single) restoreFocus(neighbor ? `edit:${neighbor.id}` : `source:${source}`);
      notify(single ? '入口已删除，可在「整理入口」恢复。' : '旧入口已清理。');
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  const restore = async entry => {
    if (busy) return;
    setBusy(true);
    try { await request('restoreEntry', { token, id: entry.id }); await refresh(); restoreFocus('cleanup-close'); notify('入口已恢复。'); }
    catch (error) { notify(error.message); }
    finally { setBusy(false); }
  };
  return <>
    <FocusButton className="secondary cleanup-trigger" focusId="catalog-cleanup" aria-haspopup="dialog" onClick={() => setOpen(true)}><Broom />整理入口</FocusButton>
    {open && <div className="modal-scrim"><section ref={dialog} className="scan-paths-dialog cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-title" data-focus-scope="active" data-focus-key={`cleanup:${source}`}>
      <header><h2 id="cleanup-title">整理{source === 'baidu' ? '网盘' : '本地'}入口</h2><FocusButton className="icon-button" focusId="cleanup-close" aria-label="关闭入口整理" data-autofocus disabled={busy} onClick={() => setOpen(false)}><X /></FocusButton></header>
      {!!stale.length && <div className="cleanup-stale"><p>{stale.length} 个入口已不在当前{source === 'baidu' ? '同步' : '扫描'}范围内。</p><FocusButton className="secondary" disabled={busy} onClick={() => setBatch([...stale])}><Broom />清理旧入口</FocusButton></div>}
      <h3>已删除的入口</h3>
      <div className="cleanup-list">{removed.map(entry => <div className="cleanup-row" key={entry.id}><div><strong>{entry.title}</strong><small>{entry.displayPath || entry.path}</small></div><FocusButton className="secondary" focusId={`restore:${entry.id}`} disabled={busy} onClick={() => restore(entry)}><ArrowCounterClockwise />恢复</FocusButton></div>)}
        {!removed.length && <p className="cleanup-empty">暂无已删除的入口。</p>}</div>
    </section></div>}
    {(removeTarget || batch) && <div className="modal-scrim"><section ref={confirmation} className="scan-paths-dialog cleanup-confirm" role="dialog" aria-modal="true" aria-labelledby="entry-remove-title" data-focus-scope="active" data-focus-key="entry-remove">
      <h2 id="entry-remove-title">{batch ? `清理 ${batch.length} 个旧入口？` : `删除「${removeTarget.title}」？`}</h2>
      <p>从首页和内容列表移除，原文件和观看记录保留。可在「整理入口」恢复。</p>
      {batch && <p className="cleanup-preview">{batch.slice(0, 4).map(entry => entry.title).join('、')}{batch.length > 4 ? '…' : ''}</p>}
      <footer><FocusButton className="secondary" data-autofocus disabled={busy} onClick={closeConfirm}>取消</FocusButton><FocusButton className="primary" disabled={busy} onClick={confirm}>{busy ? '正在移除…' : batch ? '确认清理' : '删除入口'}</FocusButton></footer>
    </section></div>}
  </>;
}
