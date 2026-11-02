// Use a monotonic clock and actual media progress. Seeks explicitly rebase the clock.
export class PlaybackClock {
  reset(now, position, active) { this.now = now; this.position = position; this.active = active; }
  sample(now, position, active) {
    const elapsed = this.active ? Math.max(0, Math.min(now - this.now, position - this.position, 5000)) : 0;
    this.reset(now, position, active);
    return Number.isFinite(elapsed) ? elapsed : 0;
  }
}

export const freshPlaybackStats = () => ({ totalMs: 0, videoMs: 0, resetAt: 0 });
export function addPlaybackTime(stats, kind, elapsedMs) {
  if (!['video', 'audio'].includes(kind) || !Number.isFinite(elapsedMs)) return;
  const delta = Math.max(0, Math.min(5000, Math.round(elapsedMs)));
  stats.totalMs = Math.max(0, stats.totalMs || 0) + delta;
  stats.videoMs = Math.max(0, stats.videoMs || 0) + (kind === 'video' ? delta : 0);
}
export function playbackStatistics(entries, records = {}) {
  const series = {}, englishVideoMs = entries.reduce((total, entry) => {
    series[entry.id] = { ...freshPlaybackStats(), ...records[entry.id] };
    return total + (entry.language !== 'other' ? series[entry.id].videoMs : 0);
  }, 0);
  return { series, englishVideoMs };
}
export function playbackTimeText(milliseconds = 0) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, remainder = seconds % 60;
  return hours ? `${hours} 小时 ${minutes} 分 ${remainder} 秒` : minutes ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`;
}
