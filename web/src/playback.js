// Keep these rules in sync with Android PlaybackPlanner and its tests.
export const PLAYBACK_MODES = ['spaced', 'sequential', 'random'];
export const MODE_LABELS = { spaced: '记忆播放', sequential: '顺序播放', random: '随机播放' };
export const DEFAULT_PLAYBACK_MODE = 'spaced';
export const MODE_DEFAULT_VERSION = 2;
export function storedPlaybackMode(mode, version = 0) {
  return version >= MODE_DEFAULT_VERSION && PLAYBACK_MODES.includes(mode) ? mode : DEFAULT_PLAYBACK_MODE;
}
export const REVIEW_DAYS = [1, 3, 7, 14, 30];
export function localDay(now = Date.now()) {
  const date = new Date(now);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
export function freshSeries(root = '') { return { root, mode: DEFAULT_PLAYBACK_MODE, modeDefaultVersion: MODE_DEFAULT_VERSION, resumePath: '', lastPath: '', randomPlayed: [], items: {} }; }
const itemFor = (series, path) => series.items[path] ||= {
  firstDay: -1, lastDay: -1, dueDay: -1, startedAt: 0, stage: 0, completions: 0, positionMs: 0, durationMs: 0,
};
export function selectPlayback(paths, series, today = localDay(), restart = true, random = Math.random) {
  let review = '', earliest = Infinity, nextDay = -1, dueCount = 0, newToday = 0;
  for (const path of paths) {
    const item = series.items[path]; if (!item?.completions) continue;
    if (item.firstDay === today) newToday++;
    if (item.dueDay >= 0 && (nextDay < 0 || item.dueDay < nextDay)) nextDay = item.dueDay;
    if (item.dueDay <= today && item.lastDay < today) {
      dueCount++;
      if (item.dueDay < earliest) { earliest = item.dueDay; review = path; }
    }
  }
  const result = (path, reason) => ({ path, reason, dueCount, newToday, nextDay });
  if (!paths.length) return result('', 'empty');
  if (paths.includes(series.resumePath)) return result(series.resumePath, 'resume');
  if (series.mode === 'random') {
    // Draw without replacement. Only natural completion consumes an item; pauses,
    // planning and restarts keep this round's completed set and unfinished media.
    series.randomPlayed = [...new Set((series.randomPlayed || []).filter(path => paths.includes(path)))];
    let remaining = paths.filter(path => !series.randomPlayed.includes(path));
    if (!remaining.length) { series.randomPlayed = []; remaining = paths; }
    // Avoid repeating the boundary episode when the next shuffled round begins.
    if (remaining.length > 1) remaining = remaining.filter(path => path !== series.lastPath);
    return result(remaining[Math.floor(random() * remaining.length)], 'random');
  }
  if (series.mode !== 'spaced') {
    const next = paths.indexOf(series.lastPath) + 1;
    return next < paths.length ? result(paths[next], 'next') : result(restart ? paths[0] : '', restart ? 'restart' : 'complete');
  }
  if (review) return result(review, 'review');
  const next = (paths.indexOf(series.lastPath) + 1) % paths.length;
  for (let offset = 0; offset < paths.length; offset++) {
    const path = paths[(next + offset) % paths.length];
    if (!series.items[path]?.completions) return result(path, 'new');
  }
  // Keep playing until the parent's time limit; same-day repeats keep their review stage.
  return result(paths[next], 'repeat');
}
export function startPlayback(series, path, now = Date.now()) { series.resumePath = path; itemFor(series, path).startedAt = now; }
export function progressPlayback(series, path, positionMs, durationMs) {
  if (series.resumePath !== path) return;
  const item = itemFor(series, path); item.durationMs = Math.max(0, durationMs);
  item.positionMs = Math.max(0, Math.min(positionMs, item.durationMs));
}
export function completePlayback(series, path, today = localDay()) {
  if (series.mode === 'random') {
    series.randomPlayed ||= [];
    if (!series.randomPlayed.includes(path)) series.randomPlayed.push(path);
  }
  const item = itemFor(series, path);
  if (!item.completions) { item.firstDay = today; item.stage = 0; item.dueDay = today + REVIEW_DAYS[0]; }
  else if (item.dueDay <= today && item.lastDay < today) {
    item.stage = Math.min(item.stage + 1, REVIEW_DAYS.length - 1); item.dueDay = today + REVIEW_DAYS[item.stage];
  }
  item.lastDay = today; item.completions++; item.positionMs = 0; series.lastPath = path;
  if (series.resumePath === path) series.resumePath = '';
}
