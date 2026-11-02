package com.pipi.kids;

import java.util.List;

/** Game unlocks count whole-series exposure, independently of statistics resets. */
final class GameProgress {
    static final int DEFAULT_ROUNDS = 0;
    static int rounds(int value) { return value >= 0 && value <= 5 ? value : DEFAULT_ROUNDS; }
    static void record(PlaybackPlanner.Item item, long elapsedMs) {
        item.gameWatchedMs += Math.max(0, Math.min(5000, elapsedMs));
    }
    static void complete(PlaybackPlanner.Item item) {
        if (item.durationMs > 0 && item.gameWatchedMs >= Math.max(item.durationMs * .95, item.durationMs - 1500)) item.gameCompletions++;
        item.gameWatchedMs = 0;
    }
    static int completedRounds(List<String> paths, PlaybackPlanner.Series series) {
        if (paths.isEmpty()) return 0;
        int count = Integer.MAX_VALUE;
        for (String path : paths) {
            PlaybackPlanner.Item item = series.items.get(path);
            count = Math.min(count, item == null ? 0 : Math.max(0, item.gameCompletions));
        }
        return count;
    }
}
