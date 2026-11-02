import { useEffect, useRef } from 'react';
import { directionalTarget } from './focus-geometry.js';

const FOCUSABLE = '[data-focusable],button,input:not([type="hidden"]),select,textarea,a[href]';
const DIRECTIONS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const keyAliases = { Select: 'Enter', Accept: 'Enter', NumpadEnter: 'Enter', DPAD_CENTER: 'Enter',
  BrowserBack: 'Escape', GoBack: 'Escape', Back: 'Escape', Esc: 'Escape' };
export const remoteKey = event => keyAliases[event.key] || event.key ||
  ({ 13: 'Enter', 23: 'Enter', 27: 'Escape', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' }[event.keyCode]);

function visible(element) {
  if (!element?.isConnected || element.disabled || element.closest('[hidden],[aria-hidden="true"]')) return false;
  const box = element.getBoundingClientRect(), style = getComputedStyle(element);
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}
export function topFocusScope(root = document) {
  const scopes = [...root.querySelectorAll('[data-focus-scope="active"]')].filter(visible);
  return scopes[scopes.length - 1] || root.body;
}
export function focusCandidates(scope) {
  return [...scope.querySelectorAll(FOCUSABLE)].filter(element => visible(element) &&
    element.getAttribute('tabindex') !== '-1' && !element.closest('[data-remote-ignore]'));
}

// Prefer candidates in the same row/column before moving diagonally to a toolbar.
export function nextInDirection(current, candidates, key) {
  const options = candidates.filter(element => element !== current)
    .map(element => ({ element, rect: element.getBoundingClientRect() }));
  const grid = current.closest('[data-focus-grid]');
  const row = current.closest('[data-focus-row]');
  const column = current.closest('[data-focus-column]');
  if (column && (key === 'ArrowUp' || key === 'ArrowDown')) {
    // Follow each series' cover/title/topic actions before leaving its column.
    const peers = candidates.filter(element => element.closest('[data-focus-column]') === column);
    const next = peers[peers.indexOf(current) + (key === 'ArrowDown' ? 1 : -1)];
    if (next) return next;
  }
  if (row && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    return directionalTarget(current.getBoundingClientRect(), options.filter(({ element }) =>
      element.closest('[data-focus-row]') === row), key)?.element || null;
  }
  // A fixed toolbar can be closer than the preceding off-screen file row.
  // Traverse the library rows first; only the first row moves Up to the toolbar.
  if (grid && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const row = directionalTarget(current.getBoundingClientRect(), options.filter(({ element }) =>
      element.closest('[data-focus-grid]') === grid), key);
    if (row) return row.element;
    if (key === 'ArrowDown') return null;
  }
  const target = directionalTarget(current.getBoundingClientRect(), options, key);
  return target?.element || null;
}

export function focusRemote(element, managed = false) {
  if (!element?.isConnected) return;
  if (!managed && !element.dispatchEvent(new CustomEvent('pipi-focus-request', { bubbles: true, cancelable: true }))) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}

export function useRemoteBack(ref, onBack) {
  const callback = useRef(onBack); callback.current = onBack;
  useEffect(() => {
    const element = ref.current;
    const listener = event => { event.preventDefault(); callback.current(); };
    element?.addEventListener('pipi-back', listener);
    return () => element?.removeEventListener('pipi-back', listener);
  });
}

export function useRemoteNavigation(onBack) {
  const back = useRef(onBack); back.current = onBack;
  useEffect(() => installRemoteNavigation(() => back.current?.()), []);
}

export function installRemoteNavigation(onBack) {
    const memory = new Map(), scopeIds = new WeakMap();
    let sequence = 0, activeScope = null, activeId = '', highlighted = null, frame = 0, pending = null, scopeLoading = false;
    let held = null, lastMoveAt = 0;
    const instanceFor = scope => {
      if (!scopeIds.has(scope)) scopeIds.set(scope, `scope-${++sequence}`);
      return scopeIds.get(scope);
    };
    const idFor = scope => scope.getAttribute('aria-modal') === 'true'
      ? `${instanceFor(scope)}:${scope.dataset.focusKey || ''}` : scope.dataset.focusKey || instanceFor(scope);
    const mark = element => {
      if (highlighted !== element) {
        highlighted?.removeAttribute('data-remote-focused'); highlighted?.removeAttribute('data-tv-focus');
      }
      highlighted = element;
      element?.setAttribute('data-remote-focused', 'true');
      element?.setAttribute('data-tv-focus', 'true');
      if (element && window.PipiTV?.focusChanged) window.PipiTV.focusChanged(element.dataset.focusId ||
        element.getAttribute('aria-label') || element.id || element.textContent.trim().slice(0, 120));
    };
    const remembered = (scope, id) => {
      const saved = memory.get(id), candidates = focusCandidates(scope);
      return candidates.find(element => saved?.key && element.dataset.focusId === saved.key) ||
        (candidates.includes(saved?.element) ? saved.element : null);
    };
    const initial = scope => focusCandidates(scope).find(element => element.hasAttribute('data-autofocus')) ||
      scope.querySelector('[data-autofocus][tabindex="-1"]') || focusCandidates(scope)[0] || scope;
    const focus = (element, remember = true) => {
      // Loading fallbacks must not replace a folder's saved content selection.
      const oldPending = pending;
      if (!remember) pending = activeId;
      focusRemote(element, true); mark(element);
      // TV WebViews do not consistently emit focusin for programmatic focus.
      if (remember && !pending && activeScope?.contains(element) && activeScope.dataset.focusLoading !== 'true')
        memory.set(activeId, { key: element.dataset.focusId, element });
      pending = oldPending;
    };
    const reconcile = () => {
      frame = 0;
      const scope = topFocusScope(), id = idFor(scope), changed = scope !== activeScope || id !== activeId;
      if (changed) { activeScope = scope; activeId = id; pending = id; held = null; }
      const loading = scope.dataset.focusLoading === 'true';
      // Effects can begin a reload after the first frame of an already-visited folder.
      // Keep its saved content selection pending while temporary toolbar focus is used.
      if (loading && (!scopeLoading || changed)) pending = id;
      scopeLoading = loading;
      if (pending && !loading) {
        pending = null;
        focus(remembered(scope, id) || initial(scope));
      } else if (visible(highlighted) && scope.contains(highlighted)) {
        if (document.activeElement !== highlighted) focus(highlighted, false);
        else mark(highlighted);
      } else if (!scope.contains(document.activeElement) || !visible(document.activeElement)) {
        focus(remembered(scope, id) || initial(scope), !loading);
      } else mark(document.activeElement);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(reconcile); };
    const onFocus = event => {
      const scope = topFocusScope(), id = idFor(scope), element = event.target;
      if (!scope.contains(element)) { schedule(); return; }
      // These surfaces also own their own focus (player menu and optional desktop typing).
      if (scope.classList.contains('immersive-player') || element.classList.contains('remote-text-preview')) {
        mark(element); return;
      }
      // Chromium 83 can focus the first button during a page mount. Do not let
      // that temporary native focus overwrite the page's saved selection.
      if (scope !== activeScope || id !== activeId || element !== highlighted) { schedule(); return; }
      mark(element);
    };
    const consume = event => { event.preventDefault(); event.stopPropagation(); };
    const keydown = event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      // Text composition, cursor movement and IME confirmation belong to the platform.
      if (event.target?.getAttribute?.('data-system-text-input') === 'true' &&
          !['Escape', 'Tab'].includes(remoteKey(event))) return;
      const key = remoteKey(event), scope = topFocusScope(), candidates = focusCandidates(scope);
      if (DIRECTIONS[key]) {
        // The full-screen player owns its hidden canvas and range control.
        if (event.target.type === 'range' && ['ArrowLeft', 'ArrowRight'].includes(key)) return;
        consume(event);
        const now = performance.now();
        if (event.repeat && now - lastMoveAt < 110) return;
        lastMoveAt = now;
        const current = candidates.includes(highlighted) ? highlighted : document.activeElement;
        if (!candidates.includes(current)) { focus(initial(scope)); return; }
        const next = nextInDirection(current, candidates, key);
        if (next) focus(next);
      } else if (key === 'Tab') {
        consume(event);
        const index = candidates.indexOf(candidates.includes(highlighted) ? highlighted : document.activeElement), count = candidates.length;
        if (count) focus(candidates[(index + (event.shiftKey ? -1 : 1) + count) % count]);
      } else if (key === 'Enter' || key === ' ' || key === 'Escape') {
        if (key === ' ' && event.target.tagName === 'INPUT' && !event.target.readOnly) return;
        consume(event);
        if (!event.repeat && !held) held = { key, element: candidates.includes(highlighted) ? highlighted : document.activeElement, scope, id: idFor(scope) };
      }
    };
    const keyup = event => {
      if (event.target?.getAttribute?.('data-system-text-input') === 'true' && remoteKey(event) !== 'Escape') { held = null; return; }
      const key = remoteKey(event);
      if (!['Enter', ' ', 'Escape'].includes(key)) return;
      if (event.defaultPrevented) { held = null; return; }
      consume(event);
      const press = held; held = null;
      const scope = topFocusScope();
      if (!press || press.key !== key || press.scope !== scope || press.id !== idFor(scope)) return;
      if (key === 'Escape') {
        const cancelled = !scope.dispatchEvent(new CustomEvent('pipi-back', { cancelable: true }));
        if (!cancelled) onBack?.();
      } else if (press.element === (focusCandidates(scope).includes(highlighted) ? highlighted : document.activeElement) && visible(press.element) &&
        scope.contains(press.element) && press.element.getAttribute('aria-disabled') !== 'true') press.element.click();
      schedule();
    };
    const blockOutside = event => {
      const scope = topFocusScope();
      if (scope.getAttribute('aria-modal') === 'true' && !scope.contains(event.target)) {
        event.preventDefault(); event.stopPropagation(); schedule();
      } else {
        const target = event.target.closest?.(FOCUSABLE);
        if (target && focusCandidates(scope).includes(target)) {
          if (scope !== activeScope || idFor(scope) !== activeId) reconcile();
          focus(target);
        }
      }
    };
    const focusRequest = event => {
      const scope = topFocusScope();
      if (!scope.contains(event.target) || !visible(event.target)) return;
      event.preventDefault();
      if (scope !== activeScope || idFor(scope) !== activeId) reconcile();
      focus(event.target);
    };
    const resume = () => { held = null; schedule(); };
    const nativeKey = (key, type = 'keydown', repeat = false, keyCode = 0) => {
      if (type === 'cancel') { held = null; return; }
      const event = new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, repeat,
        bubbles: true, cancelable: true });
      (document.activeElement || document.body).dispatchEvent(event);
    };
    window.__pipiRemoteKey = nativeKey;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'aria-hidden', 'data-focus-scope', 'data-focus-key', 'data-focus-loading'] });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pipi-focus-request', focusRequest);
    document.addEventListener('click', blockOutside, true);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pipi-resume', resume);
    schedule();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); highlighted?.removeAttribute('data-remote-focused'); highlighted?.removeAttribute('data-tv-focus');
      document.removeEventListener('focusin', onFocus); document.removeEventListener('click', blockOutside, true);
      document.removeEventListener('pipi-focus-request', focusRequest);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', resume); window.removeEventListener('focus', resume);
      window.removeEventListener('pipi-resume', resume);
      if (window.__pipiRemoteKey === nativeKey) delete window.__pipiRemoteKey;
    };
}
