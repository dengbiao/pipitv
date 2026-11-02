import { sha256 } from '@noble/hashes/sha2.js';
import { mediaKind, naturalSort } from './logic.js';

export function catalogPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) throw new Error('请选择有效的扫描文件夹。');
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
export const withinScanPath = (path, root) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
export function normalizeScanPaths(paths) {
  const all = [...new Set(paths.map(catalogPath))].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const result = [];
  for (const path of all) if (!result.some(root => withinScanPath(path, root))) result.push(path);
  if (result.length > 16) throw new Error('最多可设置 16 个扫描路径。');
  return result;
}
const ignored = new Set(['android', 'lost.dir', 'system volume information', '$recycle.bin', 'recycler', '__macosx', 'cache', 'caches', 'tmp', 'temp', 'thumbnails']);
export const eligibleCatalogPath = path => !path.split('/').some(part => part.startsWith('.') || ignored.has(part.toLowerCase()));
export const visibleEntries = entries => (entries || []).filter(entry => !entry.removed && !entry.hidden && entry.available !== false);
export const entrySource = entry => entry.source === 'baidu' || entry.path?.startsWith('/baidu/') ? 'baidu' : 'local';
export const sourceEntries = (entries, source) => (entries || []).filter(entry => entrySource(entry) === source);
export const staleEntries = (entries, source) => sourceEntries(entries, source).filter(entry => !entry.removed && entry.catalogReason === 'out_of_scope');
const basename = path => path.split('/').filter(Boolean).at(-1) || '本地内容';
const entryId = path => 'scan-' + [...sha256(new TextEncoder().encode(path))].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);

export function discoverContent(records, requested, previous = []) {
  const roots = normalizeScanPaths(requested), known = new Set(previous.filter(entry => !entry.demo).map(entry => catalogPath(entry.path)));
  const files = naturalSort(records.filter(file => mediaKind(file.name || file.path) && eligibleCatalogPath(file.path)));
  const candidates = [];
  const group = (path, sourceRoot, top) => {
    const descendants = files.filter(file => withinScanPath(file.path, path));
    if (!descendants.length) return;
    const anchorsBelow = [...known].some(anchor => anchor !== path && withinScanPath(anchor, path));
    const add = (target, kind, items) => candidates.push({ path: target, title: kind === 'folder' ? basename(target) : basename(target).replace(/\.[^.]+$/, ''),
      kind, sourceRoot, mediaCount: items.length, demo: items.every(file => file.builtin) });
    if (known.has(path) || (!top && !anchorsBelow)) { add(path, 'folder', descendants); return; }
    const folders = new Set(), direct = [];
    for (const file of descendants) {
      const relative = file.path.slice(path === '/' ? 1 : path.length + 1), slash = relative.indexOf('/');
      if (slash < 0) direct.push(file); else folders.add(`${path === '/' ? '' : path}/${relative.slice(0, slash)}`);
    }
    if (direct.length && !anchorsBelow) { add(path, 'folder', descendants); return; }
    for (const folder of folders) group(folder, sourceRoot, false);
    for (const file of direct) add(file.path, mediaKind(file.name || file.path), [file]);
  };
  for (const root of roots) group(root, root, true);
  return candidates;
}
export function reconcileContent(previous, candidates, roots) {
  const found = new Map(candidates.map(entry => [catalogPath(entry.path), entry]));
  const entries = previous.map(entry => {
    const match = found.get(catalogPath(entry.path)); found.delete(catalogPath(entry.path));
    const inScope = roots.some(root => withinScanPath(entry.path, root));
    return { ...entry, managed: true, available: !!match, catalogReason: match ? '' : inScope ? 'offline' : 'out_of_scope',
      ...(match ? { sourceRoot: match.sourceRoot, mediaCount: match.mediaCount } : {}) };
  });
  for (const entry of found.values()) entries.push({ ...entry, id: entryId(entry.path), cover: 'animals', mediaCover: false,
    subtitle: '', language: 'other', managed: true, available: true, hidden: false, catalogReason: '' });
  return entries;
}
