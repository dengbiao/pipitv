import { call } from './bridge.js';

// Decode one small preview at a time. Never seek or play the main player to make artwork.
const cache = new Map();
let pending = Promise.resolve();

function mediaEvent(element, name, action) {
  return new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer); element.removeEventListener(name, loaded); element.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const loaded = () => done(), failed = () => done(new Error('Preview unavailable'));
    const timer = setTimeout(failed, 10000);
    element.addEventListener(name, loaded, { once: true }); element.addEventListener('error', failed, { once: true });
    try { action(); } catch (error) { done(error); }
  });
}

async function extract(file, entryId) {
  const resolved = await call('resolveMedia', { path: file.path, entryId });
  const element = document.createElement(file.kind === 'audio' ? 'audio' : 'video');
  element.preload = 'auto'; element.muted = true; element.playsInline = true;
  try {
    await mediaEvent(element, 'loadedmetadata', () => { element.src = resolved.src; element.load(); });
    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    if (file.kind === 'audio') return { duration };
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (const fraction of [.25, .5, .75]) {
      await mediaEvent(element, 'seeked', () => { element.currentTime = Math.max(.01, Math.min(duration - .1, duration * fraction)); });
      context.fillStyle = '#111'; context.fillRect(0, 0, 480, 270);
      const scale = Math.min(480 / element.videoWidth, 270 / element.videoHeight);
      const width = element.videoWidth * scale, height = element.videoHeight * scale;
      context.drawImage(element, (480 - width) / 2, (270 - height) / 2, width, height);
      const pixels = context.getImageData(0, 0, 480, 270).data;
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 160) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 90) bright++;
      if (bright > pixels.length / 160 * .12) return { duration, image: canvas.toDataURL('image/jpeg', .78) };
    }
    return { duration };
  } finally {
    element.removeAttribute('src'); element.load();
    if (resolved.src?.startsWith('blob:')) URL.revokeObjectURL(resolved.src);
  }
}

export function episodePreview(file, entryId) {
  const key = `${entryId}:${file.path}`;
  if (!cache.has(key)) {
    const job = pending.then(() => extract(file, entryId)).catch(() => { cache.delete(key); return {}; });
    cache.set(key, job); pending = job;
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
