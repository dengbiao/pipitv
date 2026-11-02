import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, extname } from 'node:path';

const catalogFile = new URL('../../outputs/qa/game-resource-repair/catalog.json', import.meta.url);
const cacheDirectory = resolve(homedir(), '.cache/pipitv-tools/tv-preview');
const adb = resolve(homedir(), '.cache/pipitv-tools/platform-tools/adb');
const downloads = new Map();
const types = { video: 'video/mp4', audio: 'audio/mp4', pdf: 'application/pdf', image: 'image/jpeg' };

export function previewRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start
    ? { start, end, partial: true } : null;
}

export function catalogMedia(catalog, id) {
  const file = catalog.files.find(item => item.id === id);
  if (!file || !/^[a-f0-9]{24}$/.test(id) || !Number.isSafeInteger(file.size) || file.size <= 0) return null;
  return catalog.entries.some(entry => file.path.startsWith(entry.path.replace(/\/$/, '') + '/')) ? file : null;
}

async function localMedia(catalog, file) {
  await mkdir(cacheDirectory, { recursive: true });
  const target = resolve(cacheDirectory, file.id + extname(file.name));
  if (await stat(target).then(info => info.size === file.size).catch(() => false)) return target;
  // Cache only the selected original; the source USB is always read-only.
  if (!downloads.has(target)) downloads.set(target, new Promise((resolveDownload, reject) => {
    const temporary = target + '.partial';
    const process = spawn(adb, ['-s', catalog.device, 'pull', file.path, temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
    let detail = '';
    process.stderr.on('data', data => { detail = (detail + data.toString()).slice(-1000); });
    process.on('error', reject);
    process.on('close', async code => {
      try {
        if (code !== 0 || (await stat(temporary)).size !== file.size) throw new Error(detail || 'Unable to read TV media.');
        await rename(temporary, target); resolveDownload(target);
      } catch (error) { reject(error); }
    });
  }).finally(() => downloads.delete(target)));
  return downloads.get(target);
}

// Development only; the APK has no ADB/HTTP media dependency.
export function tvPreview() {
  return { name: 'pipi-local-tv-preview', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/__tv-preview/')) return next();
      const hostname = (request.headers.host || '').replace(/:\d+$/, '');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) || request.headers['sec-fetch-site'] === 'cross-site') {
        response.writeHead(403); return response.end('Local preview only.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
      try {
        const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
        if (url.pathname === '/__tv-preview/catalog') {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return response.end(request.method === 'HEAD' ? undefined : JSON.stringify(catalog));
        }
        const match = /^\/__tv-preview\/media\/([a-f0-9]{24})$/.exec(url.pathname);
        const file = match && catalogMedia(catalog, match[1]);
        if (!file) { response.writeHead(404); return response.end('Media not found.'); }
        const range = previewRange(request.headers.range, file.size);
        if (!range) { response.writeHead(416, { 'Content-Range': `bytes */${file.size}` }); return response.end(); }
        const headers = { 'Content-Type': types[file.kind] || 'application/octet-stream', 'Content-Length': range.end - range.start + 1,
          'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.size}`;
        if (request.method === 'HEAD') { response.writeHead(range.partial ? 206 : 200, headers); return response.end(); }
        const path = await localMedia(catalog, file);
        if (response.destroyed) return;
        response.writeHead(range.partial ? 206 : 200, headers);
        const stream = createReadStream(path, { start: range.start, end: range.end });
        response.on('close', () => stream.destroy()); stream.on('error', () => response.destroy()); stream.pipe(response);
      } catch {
        if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('TV content is unavailable. Please check the TV and USB connection.');
      }
    });
  } };
}
