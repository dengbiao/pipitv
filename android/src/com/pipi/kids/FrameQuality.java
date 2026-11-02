package com.pipi.kids;

/** Ignore black transitions, including frames with a small white recording toolbar. */
final class FrameQuality {
    static boolean usable(int[] colors) {
        if (colors == null || colors.length == 0) return false;
        long total = 0; int visible = 0;
        for (int color : colors) {
            int luminance = (54 * ((color >> 16) & 255) + 183 * ((color >> 8) & 255) + 19 * (color & 255)) >> 8;
            total += luminance; if (luminance >= 50) visible++;
        }
        return total >= colors.length * 35L && visible * 4 >= colors.length;
    }
}
