export const PIN_DIGITS = 4;
export const acceptsParentPin = (pin, existing = false) => typeof pin === 'string' &&
  (existing ? /^[0-9]{4,8}$/ : /^[0-9]{4}$/).test(pin);

// The input buffer and migration token stay private; the view only receives a digit count.
// Complete input is submitted synchronously, so fast OK presses cannot reuse stale React state.
export function createParentPinFlow({ pinSet, pinLength = 0, authenticate, changePin, discardToken,
  onSuccess, onChange, focusFirst }) {
  let active = true, finished = false, pin = '', firstPin = '', migrationToken = '';
  const legacy = !!pinSet && pinLength !== PIN_DIGITS;
  let view = { stage: legacy ? 'legacy' : pinSet ? 'unlock' : 'new', count: 0, busy: false, message: '',
    length: legacy && pinLength >= 4 && pinLength <= 8 ? pinLength : legacy ? 8 : PIN_DIGITS };
  const emit = patch => { view = { ...view, ...patch }; if (active) onChange?.({ ...view }); };
  const clear = patch => { pin = ''; emit({ count: 0, ...patch }); focusFirst?.(); };
  const discard = token => {
    try { if (token) Promise.resolve(discardToken?.(token)).catch(() => {}); } catch { /* Best-effort cancellation. */ }
  };
  const submit = async digits => {
    const stage = view.stage;
    if (stage === 'new') {
      firstPin = digits; clear({ stage: 'confirm', message: '再输入一次 4 位 PIN。' }); return;
    }
    if (stage === 'confirm' && digits !== firstPin) {
      firstPin = ''; clear({ stage: 'new', message: '两次输入不同，请重新设置 4 位 PIN。' }); return;
    }
    emit({ busy: true, message: stage === 'confirm' ? '正在保存…' : '正在验证…' });
    try {
      const result = stage === 'confirm' && migrationToken
        ? await changePin(migrationToken, digits) : await authenticate(digits);
      if (!active) { discard(result?.token); return; }
      if (stage === 'legacy') {
        migrationToken = result.token;
        firstPin = ''; clear({ stage: 'new', length: PIN_DIGITS, busy: false,
          message: '原 PIN 已验证，请设置新的 4 位 PIN。' });
      } else {
        migrationToken = ''; pin = ''; firstPin = ''; finished = true;
        await onSuccess(result);
      }
    } catch (error) {
      if (!active) return;
      finished = false;
      firstPin = '';
      clear({ stage: stage === 'confirm' ? 'new' : stage, busy: false,
        message: error?.message || '暂时无法验证，请重新输入。' });
    }
  };
  return {
    snapshot: () => ({ ...view }),
    activate() { active = true; },
    append(digit) {
      if (!active || finished || view.busy || !/^[0-9]$/.test(digit) || pin.length >= view.length) return;
      pin += digit; emit({ count: pin.length });
      if (pin.length === view.length) void submit(pin);
    },
    erase() { if (active && !view.busy && !finished) { pin = pin.slice(0, -1); emit({ count: pin.length }); } },
    setLegacyLength(length) {
      if (!active || view.busy || view.stage !== 'legacy' || ![4, 5, 6, 7, 8].includes(length)) return;
      clear({ length, message: '' });
    },
    dispose() {
      active = false; pin = ''; firstPin = '';
      if (!finished) discard(migrationToken);
      migrationToken = '';
    },
  };
}
