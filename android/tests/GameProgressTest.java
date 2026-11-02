package com.pipi.kids;
import java.util.Arrays;
import java.util.Collections;

public final class GameProgressTest {
    private static void equal(long actual, long expected) { if (actual != expected) throw new AssertionError(actual + " != " + expected); }
    public static void main(String[] args) {
        PlaybackPlanner.Series series = new PlaybackPlanner.Series();
        PlaybackPlanner.Item first = series.item("/one.mp4"), second = series.item("/nested/two.mp4");
        first.gameCompletions = 10; second.gameCompletions = 1;
        equal(GameProgress.completedRounds(Arrays.asList("/one.mp4", "/nested/two.mp4"), series), 1);
        equal(GameProgress.completedRounds(Arrays.asList("/one.mp4", "/new.mp4"), series), 0);
        equal(GameProgress.completedRounds(Collections.emptyList(), series), 0);
        equal(GameProgress.rounds(0), 0); equal(GameProgress.rounds(-1), 0); equal(GameProgress.rounds(3), 3);
        second.durationMs = 60000; GameProgress.record(second, 1000); GameProgress.complete(second); equal(second.gameCompletions, 1);
        for (int i = 0; i < 12; i++) GameProgress.record(second, 5000);
        GameProgress.complete(second); equal(second.gameCompletions, 2);
        GameProgress.complete(second); equal(second.gameCompletions, 2);
        equal(second.gameWatchedMs, 0);
        System.out.println("Game progress checks passed");
    }
}
