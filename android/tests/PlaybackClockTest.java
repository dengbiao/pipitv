package com.pipi.kids;

public final class PlaybackClockTest {
    private static int checks;
    private static void equal(long actual, long expected) {
        checks++; if (actual != expected) throw new AssertionError(actual + " != " + expected);
    }
    public static void main(String[] args) {
        PlaybackClock clock = new PlaybackClock();
        equal(clock.sample(0, 12000, true), 0);
        equal(clock.sample(2000, 14000, true), 2000);
        equal(clock.sample(2500, 14500, false), 500);
        equal(clock.sample(12500, 14500, false), 0);
        equal(clock.sample(13000, 14500, true), 0);
        equal(clock.sample(15000, 14500, true), 0);
        equal(clock.sample(16000, 15500, false), 1000);
        equal(clock.sample(26000, 25500, false), 0);
        clock.reset(27000, 0, true); equal(clock.sample(28000, 1000, true), 1000);
        equal(clock.sample(28500, 1500, false), 500);
        clock.reset(28500, 90000, false); equal(clock.sample(29500, 100000, false), 0);
        clock.reset(29500, 100000, true); equal(clock.sample(30500, 101000, true), 1000);
        clock.reset(30500, 1000, true); equal(clock.sample(31500, 2000, true), 1000);
        equal(clock.sample(91500, 62000, false), 5000);
        System.out.println("PlaybackClock: " + checks + " assertions passed");
    }
}
