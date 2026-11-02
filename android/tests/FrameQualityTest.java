package com.pipi.kids;

import java.util.Arrays;

public final class FrameQualityTest {
    public static void main(String[] ignored) {
        int[] pixels = new int[100];
        if (FrameQuality.usable(pixels)) throw new AssertionError("black transition accepted");
        pixels[0] = pixels[1] = 0xffffff;
        if (FrameQuality.usable(pixels)) throw new AssertionError("recording toolbar hid a black frame");
        Arrays.fill(pixels, 0x222222);
        if (FrameQuality.usable(pixels)) throw new AssertionError("dark fade accepted");
        for (int i = 0; i < pixels.length; i++) pixels[i] = i % 2 == 0 ? 0x7ecaf4 : 0xe5c548;
        if (!FrameQuality.usable(pixels)) throw new AssertionError("bright cartoon rejected");
        System.out.println("FrameQuality: 4 regression checks passed");
    }
}
