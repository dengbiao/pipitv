package com.pipi.kids;

final class PinPolicy {
    static final int DIGITS = 4;
    private PinPolicy() {}
    static boolean accepts(String pin, boolean existing) {
        return pin != null && pin.matches(existing ? "[0-9]{4,8}" : "[0-9]{4}");
    }
}
