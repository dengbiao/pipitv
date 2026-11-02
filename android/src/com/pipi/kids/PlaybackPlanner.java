package com.pipi.kids;

import java.util.Calendar;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TimeZone;

/** Playback exposure schedule, not an estimate of a child's mastery or forgetting. */
final class PlaybackPlanner {
    static final String SEQUENTIAL = "sequential", SPACED = "spaced", RANDOM = "random";
    private static final Random RANDOM_SOURCE = new Random();
    static final int MODE_DEFAULT_VERSION = 2;
    static String storedMode(String mode, int version) {
        return version >= MODE_DEFAULT_VERSION && validMode(mode) ? mode : SPACED;
    }
    static boolean validMode(String mode) { return SPACED.equals(mode) || SEQUENTIAL.equals(mode) || RANDOM.equals(mode); }
    static String modeLabel(String mode) { return RANDOM.equals(mode) ? "随机播放" : SEQUENTIAL.equals(mode) ? "顺序播放" : "记忆播放"; }
    static final int[] REVIEW_DAYS = {1, 3, 7, 14, 30};
    static final class Item {
        long firstDay = -1, lastDay = -1, dueDay = -1, startedAt;
        int stage, completions, positionMs, durationMs;
        int gameCompletions;
        long gameWatchedMs;
    }
    static final class Series {
        String root = "", mode = SPACED, resumePath = "", lastPath = "";
        final List<String> randomPlayed = new ArrayList<>();
        final Map<String, Item> items = new LinkedHashMap<>();
        Item item(String path) { Item item = items.get(path); if (item == null) { item = new Item(); items.put(path, item); } return item; }
    }
    static final class Selection {
        final String path, reason;
        final int dueCount, newToday;
        final long nextDay;
        Selection(String path, String reason, int dueCount, int newToday, long nextDay) {
            this.path = path; this.reason = reason; this.dueCount = dueCount; this.newToday = newToday; this.nextDay = nextDay;
        }
    }
    // A local calendar day, encoded independently of DST and time of day.
    static long localDay(long millis, TimeZone zone) {
        Calendar local = Calendar.getInstance(zone); local.setTimeInMillis(millis);
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")); utc.clear();
        utc.set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH));
        return utc.getTimeInMillis() / 86400000L;
    }
    static Selection select(List<String> paths, Series series, long today, boolean restart) {
        return select(paths, series, today, restart, RANDOM_SOURCE);
    }
    static Selection select(List<String> paths, Series series, long today, boolean restart, Random random) {
        String review = ""; long earliest = Long.MAX_VALUE, nextDay = -1;
        int dueCount = 0, newToday = 0;
        for (String path : paths) {
            Item item = series.items.get(path); if (item == null || item.completions == 0) continue;
            if (item.firstDay == today) newToday++;
            if (item.dueDay >= 0 && (nextDay < 0 || item.dueDay < nextDay)) nextDay = item.dueDay;
            if (item.dueDay <= today && item.lastDay < today) {
                dueCount++;
                if (item.dueDay < earliest) { earliest = item.dueDay; review = path; }
            }
        }
        if (paths.isEmpty()) return new Selection("", "empty", dueCount, newToday, nextDay);
        // Resume has priority even if the mode or calendar day has changed.
        if (paths.contains(series.resumePath)) return new Selection(series.resumePath, "resume", dueCount, newToday, nextDay);
        if (RANDOM.equals(series.mode)) {
            // A persisted completed set implements a shuffled round without replacement.
            series.randomPlayed.retainAll(paths);
            List<String> remaining = new ArrayList<>(paths); remaining.removeAll(series.randomPlayed);
            if (remaining.isEmpty()) { series.randomPlayed.clear(); remaining.addAll(paths); }
            if (remaining.size() > 1) remaining.remove(series.lastPath);
            return new Selection(remaining.get(random.nextInt(remaining.size())), "random", dueCount, newToday, nextDay);
        }
        if (!SPACED.equals(series.mode)) {
            int next = paths.indexOf(series.lastPath) + 1;
            if (next >= paths.size()) return new Selection(restart ? paths.get(0) : "", restart ? "restart" : "complete", dueCount, newToday, nextDay);
            return new Selection(paths.get(next), "next", dueCount, newToday, nextDay);
        }
        if (!review.isEmpty()) return new Selection(review, "review", dueCount, newToday, nextDay);
        int next = (paths.indexOf(series.lastPath) + 1) % paths.size();
        for (int offset = 0; offset < paths.size(); offset++) {
            String path = paths.get((next + offset) % paths.size());
            Item item = series.items.get(path);
            if (item == null || item.completions == 0) return new Selection(path, "new", dueCount, newToday, nextDay);
        }
        // Keep an active session going; only the parent's time policy ends it.
        // Same-day repeats do not advance the review stage in complete().
        return new Selection(paths.get(next), "repeat", dueCount, newToday, nextDay);
    }
    static void start(Series series, String path, long now) {
        series.resumePath = path; series.item(path).startedAt = now;
    }
    static void progress(Series series, String path, int position, int duration) {
        if (!path.equals(series.resumePath)) return; // Ignore a stale/finished player's final lifecycle callback.
        Item item = series.item(path);
        item.durationMs = Math.max(0, duration); item.positionMs = Math.max(0, Math.min(position, item.durationMs));
    }
    static void complete(Series series, String path, long today) {
        if (RANDOM.equals(series.mode) && !series.randomPlayed.contains(path)) series.randomPlayed.add(path);
        Item item = series.item(path);
        if (item.completions == 0) { item.firstDay = today; item.stage = 0; item.dueDay = today + REVIEW_DAYS[0]; }
        else if (item.dueDay <= today && item.lastDay < today) {
            item.stage = Math.min(item.stage + 1, REVIEW_DAYS.length - 1);
            item.dueDay = today + REVIEW_DAYS[item.stage];
        }
        item.lastDay = today; item.completions++; item.positionMs = 0;
        series.lastPath = path; if (path.equals(series.resumePath)) series.resumePath = "";
    }
}
