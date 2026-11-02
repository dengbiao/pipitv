package com.pipi.remote;

/** Standard USB HID usages over Bluetooth. Report IDs match the declared descriptor. */
public final class HidReports {
    public static final int KEYBOARD = 1, MOUSE = 2, CONSUMER = 3;
    public static final int ENTER = 0x28, ESCAPE = 0x29, TAB = 0x2b;
    public static final int RIGHT = 0x4f, LEFT = 0x50, DOWN = 0x51, UP = 0x52;
    public static final int BACK = 0x224;

    // Conventional boot keyboard, relative 3-button mouse, and consumer control.
    // Reference: Linkpad HidDescriptors.kt (MIT); see THIRD_PARTY_NOTICES.md.
    public static final byte[] DESCRIPTOR = bytes(
        0x05,0x01, 0x09,0x06, 0xa1,0x01, 0x85,KEYBOARD,
        0x05,0x07, 0x19,0xe0, 0x29,0xe7, 0x15,0x00, 0x25,0x01,
        0x75,0x01, 0x95,0x08, 0x81,0x02,
        0x95,0x01, 0x75,0x08, 0x81,0x01,
        0x05,0x08, 0x19,0x01, 0x29,0x05, 0x95,0x05, 0x75,0x01, 0x91,0x02,
        0x95,0x01, 0x75,0x03, 0x91,0x01,
        0x05,0x07, 0x19,0x00, 0x29,0x65, 0x15,0x00, 0x25,0x65,
        0x95,0x06, 0x75,0x08, 0x81,0x00, 0xc0,
        0x05,0x01, 0x09,0x02, 0xa1,0x01, 0x85,MOUSE,
        0x09,0x01, 0xa1,0x00,
        0x05,0x09, 0x19,0x01, 0x29,0x03, 0x15,0x00, 0x25,0x01,
        0x95,0x03, 0x75,0x01, 0x81,0x02,
        0x95,0x01, 0x75,0x05, 0x81,0x01,
        0x05,0x01, 0x09,0x30, 0x09,0x31, 0x09,0x38,
        0x15,0x81, 0x25,0x7f, 0x75,0x08, 0x95,0x03, 0x81,0x06, 0xc0,0xc0,
        0x05,0x0c, 0x09,0x01, 0xa1,0x01, 0x85,CONSUMER,
        0x19,0x00, 0x2a,0xff,0x03, 0x15,0x00, 0x26,0xff,0x03,
        0x75,0x10, 0x95,0x01, 0x81,0x00, 0xc0
    );

    private static byte[] bytes(int... values) {
        byte[] out = new byte[values.length];
        for (int i=0; i<values.length; i++) out[i]=(byte)values[i];
        return out;
    }
    public static int clamp(int v) { return Math.max(-127, Math.min(127,v)); }
    public static byte[] mouse(int buttons,int x,int y,int wheel) {
        return bytes(buttons & 7,clamp(x),clamp(y),clamp(wheel));
    }
    public static byte[] keyboard(int usage) {
        if (usage<0 || usage>0x65) throw new IllegalArgumentException("Invalid keyboard usage");
        return bytes(0,0,usage,0,0,0,0,0);
    }
    public static byte[] consumer(int usage) {
        if (usage<0 || usage>0x3ff) throw new IllegalArgumentException("Invalid consumer usage");
        return bytes(usage&255,usage>>8);
    }

    /** Retain fractional movement and split large movement without signed-byte wraparound. */
    public static final class PointerBuffer {
        private double x,y,wheel;
        private static double safe(double value) {
            return Double.isNaN(value) || Double.isInfinite(value) ? 0 : Math.max(-8192,Math.min(8192,value));
        }
        public void move(double dx,double dy) { x=safe(x+safe(dx));y=safe(y+safe(dy)); }
        public void scroll(double ticks) { wheel=safe(wheel+safe(ticks)); }
        public boolean pending() { return (int)x!=0 || (int)y!=0 || (int)wheel!=0; }
        public byte[] take(int buttons) {
            int dx=clamp((int)x),dy=clamp((int)y),dw=clamp((int)wheel);
            x-=dx;y-=dy;wheel-=dw;
            return mouse(buttons,dx,dy,dw);
        }
        public void clear() { x=y=wheel=0; }
    }
    private HidReports() {}
}
