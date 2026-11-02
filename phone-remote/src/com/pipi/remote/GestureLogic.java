package com.pipi.remote;

/** One-finger pointer/tap/hold, two-finger wheel; lifting one finger cannot cause a click. */
public final class GestureLogic {
    public interface Output {
        void move(double x,double y);
        void scroll(double ticks);
        void hold(boolean down);
        void tap();
    }
    private enum Mode { IDLE, TAP, MOVE, DRAG, SCROLL, BLOCKED }
    private Mode mode=Mode.IDLE;
    private final Output output;
    private final double slop,scrollPixels;
    private double x,y,startX,startY;
    private long began;
    public GestureLogic(Output output,double slop,double scrollPixels) {
        this.output=output;this.slop=slop;this.scrollPixels=scrollPixels;
    }
    public void down(double px,double py,long time) {
        cancel();x=startX=px;y=startY=py;began=time;mode=Mode.TAP;
    }
    public void move(double px,double py) {
        if (mode==Mode.IDLE || mode==Mode.BLOCKED || mode==Mode.SCROLL) return;
        if (mode==Mode.TAP && Math.hypot(px-startX,py-startY)>slop) mode=Mode.MOVE;
        if (mode==Mode.MOVE || mode==Mode.DRAG) output.move(px-x,py-y);
        x=px;y=py;
    }
    public boolean longPress() {
        if (mode==Mode.TAP) { mode=Mode.DRAG;output.hold(true);return true; }
        return false;
    }
    public void twoFingers(double centerY) {
        if (mode==Mode.DRAG) output.hold(false);
        mode=Mode.SCROLL;y=centerY;
    }
    public void scrollMove(double centerY) {
        if (mode==Mode.SCROLL) { output.scroll((centerY-y)/scrollPixels);y=centerY; }
    }
    public void fingerLifted() {
        if (mode==Mode.DRAG) output.hold(false);
        mode=Mode.BLOCKED;
    }
    public void up(long time) {
        if (mode==Mode.TAP && time-began<450) output.tap();
        if (mode==Mode.DRAG) output.hold(false);
        mode=Mode.IDLE;
    }
    public void cancel() {
        if (mode==Mode.DRAG) output.hold(false);
        mode=Mode.IDLE;
    }
}
