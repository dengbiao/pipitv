package com.pipi.kids;

/** Monotonic wall time bounded by real media progress; callers rebase after a seek. */
final class PlaybackClock {
    private long time, position;
    private boolean active;
    void reset(long now, long positionMs, boolean playing) { time = now; position = positionMs; active = playing; }
    long sample(long now, long positionMs, boolean playing) {
        long delta = active ? Math.max(0, Math.min(5000, Math.min(now - time, positionMs - position))) : 0;
        reset(now, positionMs, playing); return delta;
    }
}
