package com.pipi.kids;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.TimeZone;

public final class PlaybackPlannerTest {
    private static int checks;
    private static final List<String> FILES = Arrays.asList("/series/01.mp4", "/series/02.mp4", "/series/03.mp4");
    private static void equal(Object a, Object b) { checks++; if (!a.equals(b)) throw new AssertionError(a + " != " + b); }
    private static Random choice(final boolean last) {
        return new Random() { @Override public int nextInt(int bound) { return last ? bound - 1 : 0; } };
    }
    public static void main(String[] args) {
        PlaybackPlanner.Series s = new PlaybackPlanner.Series();
        equal(s.mode, PlaybackPlanner.SPACED);
        equal(PlaybackPlanner.storedMode(PlaybackPlanner.SEQUENTIAL, 0), PlaybackPlanner.SPACED);
        equal(PlaybackPlanner.storedMode(PlaybackPlanner.SEQUENTIAL, PlaybackPlanner.MODE_DEFAULT_VERSION), PlaybackPlanner.SEQUENTIAL);
        equal(PlaybackPlanner.storedMode(PlaybackPlanner.RANDOM, PlaybackPlanner.MODE_DEFAULT_VERSION), PlaybackPlanner.RANDOM);
        equal(PlaybackPlanner.storedMode("unknown", PlaybackPlanner.MODE_DEFAULT_VERSION), PlaybackPlanner.SPACED);
        equal(PlaybackPlanner.modeLabel(PlaybackPlanner.RANDOM), "随机播放");
        equal(PlaybackPlanner.select(FILES, s, 10, true).path, FILES.get(0));
        PlaybackPlanner.start(s, FILES.get(0), 1); PlaybackPlanner.progress(s, FILES.get(0), 25000, 60000);
        s.mode = PlaybackPlanner.SPACED;
        equal(PlaybackPlanner.select(FILES, s, 11, true).reason, "resume");
        equal(s.items.get(FILES.get(0)).positionMs, 25000);
        equal(s.items.get(FILES.get(0)).completions, 0); // Partial watching never counts as completed.
        PlaybackPlanner.complete(s, FILES.get(0), 11);
        equal(s.items.get(FILES.get(0)).dueDay, 12L);
        equal(PlaybackPlanner.select(FILES, s, 12, true).reason, "review");
        PlaybackPlanner.complete(s, FILES.get(0), 12);
        equal(s.items.get(FILES.get(0)).dueDay, 15L);
        PlaybackPlanner.complete(s, FILES.get(0), 12); // Voluntary repeat does not advance a review stage.
        equal(s.items.get(FILES.get(0)).stage, 1);
        PlaybackPlanner.complete(s, FILES.get(0), 20); // Missed days do not create a catch-up burst.
        equal(s.items.get(FILES.get(0)).dueDay, 27L);
        long day = 27;
        for (int n = 0; n < 5; n++) { PlaybackPlanner.complete(s, FILES.get(0), day); day = s.items.get(FILES.get(0)).dueDay; }
        equal(s.items.get(FILES.get(0)).stage, 4);
        equal(s.items.get(FILES.get(0)).dueDay - s.items.get(FILES.get(0)).lastDay, 30L);

        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.SPACED;
        PlaybackPlanner.complete(s, FILES.get(0), 40); PlaybackPlanner.complete(s, FILES.get(1), 40);
        equal(PlaybackPlanner.select(FILES, s, 40, false).path, FILES.get(2));
        PlaybackPlanner.complete(s, FILES.get(2), 40);
        equal(PlaybackPlanner.select(FILES, s, 40, false).reason, "repeat");
        equal(PlaybackPlanner.select(FILES, s, 40, false).path, FILES.get(0));
        PlaybackPlanner.complete(s, FILES.get(0), 40);
        equal(PlaybackPlanner.select(FILES, s, 40, false).path, FILES.get(1));
        equal(s.items.get(FILES.get(0)).stage, 0);
        equal(s.items.get(FILES.get(0)).dueDay, 41L);
        equal(PlaybackPlanner.select(FILES, s, 41, true).path, FILES.get(0));
        PlaybackPlanner.complete(s, FILES.get(0), 41); PlaybackPlanner.complete(s, FILES.get(1), 41);
        equal(PlaybackPlanner.select(FILES, s, 41, true).path, FILES.get(2));
        PlaybackPlanner.start(s, FILES.get(2), 100);
        equal(PlaybackPlanner.select(FILES, s, 42, true).path, FILES.get(2)); // Resume wins over due review.
        PlaybackPlanner.Series other = new PlaybackPlanner.Series(); other.mode = PlaybackPlanner.SPACED;
        equal(PlaybackPlanner.select(Collections.singletonList("/other/01.mp4"), other, 42, true).path, "/other/01.mp4");
        equal(other.items.size(), 0);
        equal(PlaybackPlanner.select(Collections.singletonList("/other/01.mp4"), s, 42, true).reason, "new");
        equal(PlaybackPlanner.select(Collections.emptyList(), s, 42, true).reason, "empty");
        PlaybackPlanner.Series single = new PlaybackPlanner.Series();
        PlaybackPlanner.complete(single, FILES.get(0), 40);
        equal(PlaybackPlanner.select(Collections.singletonList(FILES.get(0)), single, 40, false).path, FILES.get(0));

        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.SEQUENTIAL;
        for (String path : FILES) PlaybackPlanner.complete(s, path, 50);
        equal(PlaybackPlanner.select(FILES, s, 50, false).reason, "complete");
        equal(PlaybackPlanner.select(FILES, s, 50, true).path, FILES.get(0));
        PlaybackPlanner.progress(s, FILES.get(2), 50000, 60000);
        equal(s.items.get(FILES.get(2)).positionMs, 0); // onPause after completion cannot resurrect resume.

        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.RANDOM;
        equal(PlaybackPlanner.select(FILES, s, 40, false, choice(false)).path, FILES.get(0));
        equal(PlaybackPlanner.select(FILES, s, 40, false, choice(true)).path, FILES.get(2));
        for (String previous : FILES) {
            s.lastPath = previous;
            java.util.ArrayList<String> candidates = new java.util.ArrayList<>(FILES); candidates.remove(previous);
            equal(PlaybackPlanner.select(FILES, s, 40, false, choice(false)).path, candidates.get(0));
            equal(PlaybackPlanner.select(FILES, s, 40, false, choice(true)).path, candidates.get(1));
        }
        PlaybackPlanner.complete(s, FILES.get(0), 39); PlaybackPlanner.complete(s, FILES.get(1), 40);
        PlaybackPlanner.Selection randomPlan = PlaybackPlanner.select(FILES, s, 40, false, choice(true));
        equal(randomPlan.reason, "random"); equal(randomPlan.path, FILES.get(2)); equal(randomPlan.dueCount, 1);
        PlaybackPlanner.start(s, FILES.get(1), 100); PlaybackPlanner.progress(s, FILES.get(1), 25000, 60000);
        Random noDraw = new Random() { @Override public int nextInt(int bound) { throw new AssertionError("Resume must not draw a random item"); } };
        equal(PlaybackPlanner.select(FILES, s, 40, false, noDraw).path, FILES.get(1));
        equal(s.items.get(FILES.get(1)).positionMs, 25000);
        List<String> otherFiles = Arrays.asList("/other/01.mp4", "/other/sub/02.mp3");
        equal(PlaybackPlanner.select(otherFiles, s, 40, false, choice(true)).path, otherFiles.get(1));
        PlaybackPlanner.complete(s, FILES.get(1), 40);
        equal(PlaybackPlanner.select(Collections.singletonList(FILES.get(1)), s, 40, false, choice(true)).path, FILES.get(1));
        equal(PlaybackPlanner.select(Collections.emptyList(), s, 40, false, noDraw).reason, "empty");
        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.RANDOM;
        for (String path : FILES) PlaybackPlanner.complete(s, path, 40);
        for (int n = 0; n < 8; n++) {
            randomPlan = PlaybackPlanner.select(FILES, s, 40, false, choice(n % 2 == 1));
            equal(randomPlan.reason, "random"); equal(randomPlan.path.equals(s.lastPath), false);
            PlaybackPlanner.complete(s, randomPlan.path, 40);
        }
        for (PlaybackPlanner.Item item : s.items.values()) { equal(item.stage, 0); equal(item.dueDay, 41L); }
        s.mode = PlaybackPlanner.SPACED;
        equal(PlaybackPlanner.select(FILES, s, 41, false).reason, "review");
        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.RANDOM;
        String last = "";
        for (int round = 0; round < 4; round++) {
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (int n = 0; n < FILES.size(); n++) {
                randomPlan = PlaybackPlanner.select(FILES, s, 40, false, choice(n % 2 == 1));
                equal(seen.contains(randomPlan.path), false); equal(randomPlan.path.equals(last), false);
                List<String> completedRound = new java.util.ArrayList<>(s.randomPlayed);
                PlaybackPlanner.start(s, randomPlan.path, 100); PlaybackPlanner.progress(s, randomPlan.path, 1000, 60000);
                equal(s.randomPlayed, completedRound);
                PlaybackPlanner.Series restored = new PlaybackPlanner.Series(); restored.mode = s.mode;
                restored.randomPlayed.addAll(s.randomPlayed); restored.resumePath = s.resumePath; restored.lastPath = s.lastPath;
                restored.items.putAll(s.items); s = restored;
                equal(PlaybackPlanner.select(FILES, s, 40, false, noDraw).path, randomPlan.path);
                PlaybackPlanner.complete(s, randomPlan.path, 40); seen.add(randomPlan.path); last = randomPlan.path;
            }
            equal(seen, new java.util.HashSet<>(FILES)); equal(s.randomPlayed.size(), FILES.size());
        }
        s = new PlaybackPlanner.Series(); s.mode = PlaybackPlanner.RANDOM;
        PlaybackPlanner.complete(s, FILES.get(0), 40); PlaybackPlanner.complete(s, FILES.get(1), 40);
        s.mode = PlaybackPlanner.SEQUENTIAL; PlaybackPlanner.complete(s, FILES.get(2), 40);
        equal(s.randomPlayed, FILES.subList(0, 2)); s.mode = PlaybackPlanner.RANDOM;
        String added = "/series/sub/new.mp3";
        List<String> changed = Arrays.asList(FILES.get(1), FILES.get(2), added);
        equal(PlaybackPlanner.select(changed, s, 40, false, choice(false)).path, added);
        PlaybackPlanner.complete(s, added, 40);
        equal(PlaybackPlanner.select(changed, s, 40, false, choice(false)).path, FILES.get(2));
        equal(s.randomPlayed.contains(FILES.get(0)), false);
        PlaybackPlanner.complete(s, FILES.get(2), 40);
        equal(PlaybackPlanner.select(changed, s, 40, false, choice(false)).path, FILES.get(1));
        long utcMidnight = 1767225600000L;
        equal(PlaybackPlanner.localDay(utcMidnight, TimeZone.getTimeZone("Asia/Shanghai")), PlaybackPlanner.localDay(utcMidnight + 15 * 3600000L, TimeZone.getTimeZone("Asia/Shanghai")));
        equal(PlaybackPlanner.localDay(utcMidnight + 16 * 3600000L, TimeZone.getTimeZone("Asia/Shanghai")), PlaybackPlanner.localDay(utcMidnight, TimeZone.getTimeZone("Asia/Shanghai")) + 1);
        System.out.println("PlaybackPlanner: " + checks + " assertions passed");
    }
}
