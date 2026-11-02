export const DEFAULT_SETTINGS = Object.freeze({
  dailyMinutes: 30, sessionMinutes: 15, restMinutes: 10,
  startHour: 8, endHour: 20, chinese: true,
});

const bounded = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
export function normalizeSettings(input = {}) {
  return {
    dailyMinutes: bounded(input.dailyMinutes, 30, 5, 180),
    sessionMinutes: bounded(input.sessionMinutes, 15, 1, 60),
    restMinutes: bounded(input.restMinutes, 10, 1, 60),
    startHour: bounded(input.startHour, 8, 0, 23),
    endHour: bounded(input.endHour, 20, 0, 24),
    chinese: input.chinese !== false,
  };
}
export function dayKey(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function inAllowedHours(settings, now = Date.now()) {
  const hour = new Date(now).getHours();
  const { startHour: start, endHour: end } = settings;
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
export function freshUsage(now = Date.now()) {
  return { day: dayKey(now), usedMs: 0, sessionMs: 0, extraMs: 0, restUntil: 0, lastPulse: now, active: false };
}
export function settleUsage(input, settings, now = Date.now(), active = input?.active || false) {
  let usage = { ...freshUsage(now), ...input };
  const elapsed = Math.max(0, now - (usage.lastPulse || now));
  if (usage.day !== dayKey(now)) {
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const nextElapsed = Math.min(elapsed, Math.max(0, now - midnight.getTime()));
    const wasActive = usage.active;
    usage = freshUsage(now);
    usage.active = wasActive;
    usage.lastPulse = now - nextElapsed;
  }
  if (usage.restUntil && usage.restUntil <= now) {
    usage.restUntil = 0; usage.sessionMs = 0; usage.active = false;
  }
  const delta = Math.max(0, now - usage.lastPulse);
  const dailyRemaining = Math.max(0, settings.dailyMinutes * 60000 + usage.extraMs - usage.usedMs);
  const sessionRemaining = Math.max(0, settings.sessionMinutes * 60000 - usage.sessionMs);
  if (usage.active && !usage.restUntil && inAllowedHours(settings, now)) {
    const spent = Math.min(delta, dailyRemaining, sessionRemaining);
    usage.usedMs += spent;
    usage.sessionMs += spent;
    if (usage.sessionMs >= settings.sessionMinutes * 60000 && dailyRemaining > spent) {
      usage.restUntil = now + settings.restMinutes * 60000;
    }
  }
  usage.lastPulse = now;
  usage.active = !!active;
  return usage;
}
export function availability(usage, settings, now = Date.now()) {
  const dailyRemaining = Math.max(0, settings.dailyMinutes * 60000 + usage.extraMs - usage.usedMs);
  const sessionRemaining = Math.max(0, settings.sessionMinutes * 60000 - usage.sessionMs);
  let reason = '';
  if (!inAllowedHours(settings, now)) reason = 'schedule';
  else if (dailyRemaining <= 0) reason = 'daily';
  else if (usage.restUntil > now) reason = 'rest';
  else if (sessionRemaining <= 0) reason = 'session';
  return { reason, remainingMs: reason ? 0 : Math.min(dailyRemaining, sessionRemaining),
    dailyRemainingMs: dailyRemaining, restUntil: usage.restUntil };
}
export function clockText(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function mediaKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['mp4', 'm4v', 'mkv', 'mov', 'webm', 'avi', 'ts', 'm2ts', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'aac', 'm4a', 'wav', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return '';
}
export function isWithin(path, root) {
  const normalize = value => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = normalize(path), r = normalize(root);
  return p === r || p.startsWith(`${r}/`);
}
export function naturalSort(items) {
  return [...items].sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1)
    || a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
}

// Episodes follow the visible folder order; pictures, PDFs and subfolders are not episodes.
export function episodeQueue(items, current) {
  if (!['video', 'audio'].includes(current.kind)) return [current];
  const episodes = naturalSort((items || []).filter(item => item.kind === current.kind));
  return episodes.some(item => item.path === current.path) ? episodes : [current];
}
export function adjacentEpisode(episodes, path, direction) {
  if (direction !== -1 && direction !== 1) return null;
  const index = episodes.findIndex(item => item.path === path);
  return index < 0 ? null : episodes[index + direction] || null;
}
