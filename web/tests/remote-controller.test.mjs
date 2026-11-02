import test from 'node:test';
import assert from 'node:assert/strict';
import { installRemoteNavigation } from '../src/remoteNavigation.js';

// The TV regression: focus() updates activeElement but focusin may never fire.
// This intentionally avoids implementing focusin so selection memory must survive it.
function environment() {
  const names = ['document', 'window', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'KeyboardEvent'];
  const previous = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  const frames = new Map(); let frameId = 0, observer;
  const doc = new EventTarget(), win = new EventTarget();
  class Element extends EventTarget {
    constructor(id, x = 0, y = 0) {
      super(); this.dataset = { focusId: id }; this.attributes = new Map(); this.children = []; this.isConnected = true;
      this.disabled = false; this.tagName = 'BUTTON'; this.classList = { contains: () => false }; this.scrolls = 0;
      this.rect = { x, y, left: x, right: x + 100, top: y, bottom: y + 80, width: 100, height: 80 };
    }
    getBoundingClientRect() { return this.rect; }
    closest() { return null; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    querySelectorAll() { return this.children; }
    querySelector() { return null; }
    focus() { doc.activeElement = this; }
    scrollIntoView() { this.scrolls++; }
    click() { this.onClick?.(); }
    get textContent() { return this.dataset.focusId || ''; }
  }
  class Key extends Event {
    constructor(type, init) { super(type, init); this.key = init.key; this.repeat = !!init.repeat; }
  }
  doc.body = new Element('body'); doc.scopes = []; doc.querySelectorAll = () => doc.scopes;
  globalThis.document = doc; globalThis.window = win;
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.MutationObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() {} };
  globalThis.KeyboardEvent = Key;
  const scope = (key, buttons) => {
    const root = new Element('scope'); root.dataset.focusKey = key; root.tagName = 'SECTION'; root.children = buttons; return root;
  };
  const mount = root => {
    for (const old of doc.scopes) { old.isConnected = false; for (const button of old.children) button.isConnected = false; }
    doc.scopes = [root]; doc.body.children = [root]; doc.activeElement = root.children[0]; observer?.();
  };
  const flush = () => {
    let limit = 20;
    while (frames.size && limit--) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); }
    assert.ok(limit > 0, 'navigation must settle without an animation-frame loop');
  };
  const send = (type, key, repeat = false) => win.dispatchEvent(new Key(type, { key, repeat, cancelable: true }));
  const press = key => { send('keydown', key); send('keyup', key); flush(); };
  return { doc, win, Element, scope, mount, flush, send, press, mutate: () => observer(), restore() {
    for (const name of names) { if (previous[name] === undefined) delete globalThis[name]; else globalThis[name] = previous[name]; }
  } };
}

test('page and async folder restoration work without any focusin events', () => {
  const e = environment(); let cleanup, folder;
  try {
    const makeFolder = () => {
      const back = new e.Element('back'), first = new e.Element('file-1', 0, 200), second = new e.Element('file-2', 120, 200);
      first.setAttribute('data-autofocus', 'true');
      folder = e.scope('media:/folder', [back, first, second]); return folder;
    };
    const makeHome = () => {
      const first = new e.Element('entry-1', 0, 200), second = new e.Element('entry-2', 120, 200);
      first.setAttribute('data-autofocus', 'true'); second.onClick = () => e.mount(makeFolder());
      return e.scope('home', [first, second]);
    };
    e.mount(makeHome()); cleanup = installRemoteNavigation(() => e.mount(makeHome())); e.flush();
    e.press('ArrowRight'); e.press('Enter'); e.press('ArrowRight');
    assert.equal(e.doc.activeElement.dataset.focusId, 'file-2');
    e.press('Escape'); assert.equal(e.doc.activeElement.dataset.focusId, 'entry-2');
    e.press('Enter'); assert.equal(e.doc.activeElement.dataset.focusId, 'file-2');
    const toolbar = folder.children[0];
    for (const button of folder.children.slice(1)) button.isConnected = false;
    folder.children = [toolbar]; folder.dataset.focusLoading = 'true'; e.doc.activeElement = toolbar; e.mutate(); e.flush();
    const first = new e.Element('file-1', 0, 200), second = new e.Element('file-2', 120, 200);
    first.setAttribute('data-autofocus', 'true'); folder.children = [toolbar, first, second]; folder.dataset.focusLoading = 'false'; e.mutate(); e.flush();
    assert.equal(e.doc.activeElement, second); assert.ok(second.scrolls > 0);
  } finally { cleanup?.(); e.restore(); }
});

test('scrolled library rows stay in file order before Up reaches the fixed toolbar', () => {
  const e = environment(); let cleanup;
  try {
    const back = new e.Element('back', 0, 0), first = new e.Element('file-1', 0, -100), second = new e.Element('file-4', 0, 180);
    const grid = {};
    for (const file of [first, second]) file.closest = selector => selector === '[data-focus-grid]' ? grid : null;
    second.setAttribute('data-autofocus', 'true');
    e.mount(e.scope('media:/folder', [back, first, second])); cleanup = installRemoteNavigation(() => {}); e.flush();
    e.press('ArrowUp');
    assert.equal(e.doc.activeElement, first, 'Up must reach the preceding file even when the fixed toolbar is closer');
    // The scroll container has brought the first row back into view.
    first.rect = { ...first.rect, y: 120, top: 120, bottom: 200 };
    second.rect = { ...second.rect, y: 400, top: 400, bottom: 480 };
    e.press('ArrowUp'); assert.equal(e.doc.activeElement, back, 'the first row can reach Back');
    e.press('ArrowDown'); assert.equal(e.doc.activeElement, first, 'Down returns from the toolbar to the list');
    e.press('ArrowDown'); assert.equal(e.doc.activeElement, second);
    e.press('ArrowDown'); assert.equal(e.doc.activeElement, second, 'the final row does not jump to the toolbar');
  } finally { cleanup?.(); e.restore(); }
});

test('OK activates once on release; repeats and canceled releases never add clicks', () => {
  const e = environment(); let cleanup, clicks = 0;
  try {
    const button = new e.Element('action'); button.onClick = () => clicks++;
    e.mount(e.scope('home', [button])); cleanup = installRemoteNavigation(() => {}); e.flush();
    e.send('keydown', 'Enter'); e.send('keydown', 'Enter', true); e.send('keydown', 'Enter', true);
    assert.equal(clicks, 0); e.send('keyup', 'Enter'); assert.equal(clicks, 1);
    e.send('keydown', 'Enter'); e.win.__pipiRemoteKey('Enter', 'cancel'); e.send('keyup', 'Enter'); assert.equal(clicks, 1);
    e.press('Enter'); assert.equal(clicks, 2);
  } finally { cleanup?.(); e.restore(); }
});
