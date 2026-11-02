package com.pipi.kids;

public final class PinPolicyTest {
    private static void expect(String pin, boolean existing, boolean expected) {
        if (PinPolicy.accepts(pin, existing) != expected) throw new AssertionError("PIN length policy mismatch");
    }
    public static void main(String[] args) {
        expect("2468", false, true); expect("0000", false, true);
        for (String value : new String[]{"", "123", "12345", "12345678", "12a4", "１２３４"}) expect(value, false, false);
        for (String value : new String[]{"1234", "12345", "123456", "1234567", "12345678"}) expect(value, true, true);
        expect("123456789", true, false); expect(null, false, false);
        System.out.println("PinPolicy: new/change PIN fixed at 4; existing 4-8 digit PINs remain verifiable");
    }
}
