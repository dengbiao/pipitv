import React, { useEffect, useRef, useState } from 'react';
import { X, Check, LockKey, Backspace, CaretDown, PencilSimple } from '@phosphor-icons/react';
import { focusRemote, useRemoteBack } from './remoteNavigation.js';
import { createParentPinFlow } from './parent-pin.js';
import './remote-controls.css';

export function FocusButton({ children, className = '', focusId, ...props }) {
  return <button data-focusable="true" data-focus-id={focusId} className={className} {...props}>{children}</button>;
}

export function ParentGate({ pinSet, pinLength = 0, onClose, onUnlock, onAuthenticate, onChangePin, onDiscardToken }) {
  const dialog = useRef(null), callbacks = useRef(null), flow = useRef(null);
  callbacks.current = { onClose, onUnlock, onAuthenticate, onChangePin, onDiscardToken };
  const firstKey = () => requestAnimationFrame(() => focusRemote(dialog.current?.querySelector('[data-focus-id="pin-1"]')));
  if (!flow.current) flow.current = createParentPinFlow({ pinSet, pinLength,
    authenticate: pin => callbacks.current.onAuthenticate(pin),
    changePin: (parentToken, pin) => callbacks.current.onChangePin(parentToken, pin),
    discardToken: parentToken => callbacks.current.onDiscardToken?.(parentToken),
    onSuccess: result => callbacks.current.onUnlock(result),
    onChange: state => setForm(state), focusFirst: firstKey });
  const [form, setForm] = useState(() => flow.current.snapshot());
  const close = () => { flow.current.dispose(); callbacks.current.onClose(); };
  useRemoteBack(dialog, close);
  useEffect(() => {
    const controller = flow.current; controller.activate();
    const handleKey = event => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); if (!event.repeat) controller.append(event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); controller.erase(); }
    };
    const element = dialog.current; element.addEventListener('keydown', handleKey);
    return () => { controller.dispose(); element.removeEventListener('keydown', handleKey); };
  }, []);
  const title = form.stage === 'legacy' ? '先验证原 PIN' : form.stage === 'unlock' ? '输入 4 位家长 PIN'
    : form.stage === 'confirm' ? '再输入一次 4 位 PIN' : '设置 4 位家长 PIN';
  return <div className="modal-scrim parent-theme"><section ref={dialog} className="pin-dialog remote-pin-dialog"
    data-focus-scope="active" data-focus-key={`pin:${form.stage}:${form.length}`}
    role="dialog" aria-modal="true" aria-labelledby="pin-title">
    <FocusButton type="button" className="close-dialog icon-button" aria-label="关闭家长验证" onClick={close}><X /></FocusButton>
    <div className="pin-symbol"><LockKey size={36} weight="duotone" /></div>
    <h2 id="pin-title">{title}</h2>
    {form.stage === 'legacy' && <p>验证原 PIN 后，设置新的 4 位 PIN。</p>}
    {form.stage === 'legacy' && <div className="legacy-pin-length"><RemoteSelect label="原 PIN 位数" value={form.length}
      options={[4, 5, 6, 7, 8]} format={length => `${length} 位`} onChange={length => flow.current.setLegacyLength(length)} /></div>}
    <div className="pin-digits" role="status" aria-label={`已输入 ${form.count} 位，共 ${form.length} 位数字`}>
      {Array.from({ length: form.length }, (_, index) => <span key={index} className={index < form.count ? 'filled' : ''} aria-hidden="true">{index < form.count ? '●' : '○'}</span>)}
    </div>
    <p className="pin-message" role="status" aria-live="polite">{form.message || '方向键选择，OK 输入，返回取消。'}</p>
    <div className="pin-keypad" aria-label="屏幕数字键盘" aria-busy={form.busy}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => <FocusButton type="button" key={digit}
        data-focus-id={`pin-${digit}`} data-autofocus={digit === '1' ? 'true' : undefined}
        onClick={() => flow.current.append(digit)} aria-disabled={form.busy}>{digit}</FocusButton>)}
      <FocusButton type="button" data-focus-id="pin-delete" onClick={() => flow.current.erase()} aria-label="删除一位" aria-disabled={form.busy}><Backspace /><span>删除</span></FocusButton>
      <FocusButton type="button" data-focus-id="pin-0" onClick={() => flow.current.append('0')} aria-disabled={form.busy}>0</FocusButton>
      <FocusButton type="button" data-focus-id="pin-cancel" onClick={close} aria-label="取消家长验证"><X /><span>取消</span></FocusButton>
    </div>
  </section></div>;
}

export function RemoteSelect({ label, value, options, onChange, format = String, autoFocus = false }) {
  const [open, setOpen] = useState(false), dialog = useRef(null);
  useRemoteBack(dialog, () => setOpen(false));
  return <>
    <FocusButton type="button" className="remote-select" aria-label={`${label}：${format(value)}`}
      aria-haspopup="dialog" aria-expanded={open} data-autofocus={autoFocus ? 'true' : undefined}
      onClick={() => setOpen(true)}><span>{format(value)}</span><CaretDown /></FocusButton>
    {open && <div className="modal-scrim remote-dialog-layer"><section ref={dialog} className="remote-options-dialog"
      data-focus-scope="active" data-focus-key={`options:${label}`} role="dialog" aria-modal="true" aria-label={`选择${label}`}>
      <header><h2>{label}</h2><FocusButton type="button" className="icon-button" aria-label={`取消选择${label}`} onClick={() => setOpen(false)}><X /></FocusButton></header>
      <p>方向键选择，OK 确认，返回取消。</p>
      <div className="remote-options">{options.map(option => <FocusButton type="button" key={option}
        data-autofocus={option === value ? 'true' : undefined} data-focus-id={`option-${option}`}
        aria-pressed={option === value} onClick={() => { onChange(option); setOpen(false); }}>{format(option)}</FocusButton>)}</div>
    </section></div>}
  </>;
}

// Native television fields use the installed IME; the browser uses its normal text input.
export function RemoteTextField({ label, value, onChange, placeholder, maxLength = 40, autoFocus = false, focusId, onRequestEdit }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const dialog = useRef(null);
  useRemoteBack(dialog, () => setOpen(false));
  const edit = async () => {
    if (busy) return;
    setMessage('');
    if (!onRequestEdit) { setDraft(value || ''); setOpen(true); return; }
    setBusy(true);
    try {
      const result = await onRequestEdit({ label, value: value || '', maxLength });
      if (result && !result.cancelled) onChange(result.value.slice(0, maxLength));
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const finish = () => { onChange(draft); setOpen(false); };
  return <>
    <FocusButton type="button" className={`remote-text-field ${value ? '' : 'is-empty'}`} data-autofocus={autoFocus ? 'true' : undefined} focusId={focusId}
      aria-label={`${label}：${value || '未填写'}，按 OK 编辑`} aria-haspopup="dialog" aria-expanded={open || busy} aria-disabled={busy} onClick={edit}>
      <span>{value || placeholder || '按 OK 输入'}</span><PencilSimple /></FocusButton>
    {message && <p className="text-input-error" role="status">{message}</p>}
    {open && <div className="modal-scrim remote-dialog-layer"><section ref={dialog} className="remote-keyboard-dialog system-text-dialog"
      data-focus-scope="active" data-focus-key={`text:${label}`} role="dialog" aria-modal="true" aria-label={`编辑${label}`}>
      <header><h2>{label}</h2><FocusButton type="button" className="icon-button" aria-label={`取消编辑${label}`} onClick={() => setOpen(false)}><X /></FocusButton></header>
      <input className="remote-text-preview" data-autofocus data-system-text-input="true" aria-label={`${label}草稿`} value={draft} maxLength={maxLength}
        onChange={event => setDraft(event.target.value)} placeholder={placeholder} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); finish(); }
        }} />
      <div className="system-text-actions"><FocusButton type="button" className="secondary" onClick={() => setOpen(false)}>取消</FocusButton>
        <FocusButton type="button" className="primary" onClick={finish}><Check />完成</FocusButton></div>
    </section></div>}
  </>;
}
