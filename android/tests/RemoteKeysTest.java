package com.pipi.kids;

public final class RemoteKeysTest {
    private static void expect(int code, String expected) {
        String actual = RemoteKeys.key(code);
        if (expected == null ? actual != null : !expected.equals(actual))
            throw new AssertionError("Key " + code + ": expected " + expected + ", got " + actual);
    }
    public static void main(String[] args) {
        expect(19, "ArrowUp"); expect(20, "ArrowDown"); expect(21, "ArrowLeft"); expect(22, "ArrowRight");
        expect(23, "Enter"); expect(66, "Enter"); expect(160, "Enter"); expect(96, "Enter");
        expect(4, "Escape"); expect(111, "Escape"); expect(97, "Escape"); expect(82, "ContextMenu");
        expect(3, null); expect(24, null); expect(25, null); expect(26, null);
        System.out.println("RemoteKeysTest: navigation/OK/back mapped; Home/volume/power passed through");
    }
}
