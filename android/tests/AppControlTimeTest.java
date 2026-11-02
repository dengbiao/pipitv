package com.pipi.kids;

import java.util.Calendar;

public final class AppControlTimeTest {
    static int checks;
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); checks++; }
    static long noon() { Calendar c = Calendar.getInstance(); c.set(2026, 10, 1, 12, 0, 0); c.set(Calendar.MILLISECOND, 0); return c.getTimeInMillis(); }
    public static void main(String[] args) {
        long now = noon();
        TimePolicy p = new TimePolicy(); p.dailyMinutes = 10; p.sessionMinutes = 1;
        p.learning = true; p.foreground = true; p.tick(now, 1000); p.tick(now + 10000, 11000);
        check(p.usedMs == 10000, "local playback counts");
        p.learning = false; p.foreground = false; p.external = true; p.tick(now + 20000, 21000);
        check(p.usedMs == 20000 && p.sessionMs == 20000, "external controlled app shares existing budgets after launcher pauses");
        p.parent = true; p.tick(now + 30000, 31000);
        check(p.usedMs == 30000, "a parent token left in the paused launcher cannot exempt another controlled app");
        p.parent = false; p.learning = true; p.foreground = true; p.tick(now + 40000, 41000);
        check(p.usedMs == 40000, "overlapping lifecycle handoff never counts twice");
        p.external = false; p.foreground = false; p.tick(now + 50000, 51000);
        check(p.usedMs == 40000, "unmanaged apps and screen-off periods consume no shared time");
        p.external = true; p.tick(now + 80000, 81000);
        check(p.usedMs == 60000 && p.sessionMs == 60000, "switching controlled apps does not reset the session and stops at the cap");
        check(p.reason(now + 80000).equals("rest") && p.remaining(now + 80000) == 0, "controlled apps enter the same rest");
        p.external = false; p.tick(now + 90000, 91000); check(p.usedMs == 60000, "time on the rest screen is free");
        p.tick(p.restUntil + 1, 800001); check(p.sessionMs == 0 && p.restUntil == 0, "the same rest expiry resets the next shared session");

        TimePolicy daily = new TimePolicy(); daily.dailyMinutes = 5; daily.sessionMinutes = 10;
        daily.tick(now, 1000); daily.usedMs = 295000; daily.external = true; daily.tick(now + 10000, 11000);
        check(daily.usedMs == 300000 && daily.reason(now + 10000).equals("daily"), "external use respects the remaining daily allowance");
        TimePolicy hours = new TimePolicy(); hours.startHour = 14; hours.endHour = 16; hours.external = true;
        hours.tick(now, 1000); hours.tick(now + 10000, 11000);
        check(hours.usedMs == 0 && hours.reason(now + 10000).equals("schedule"), "external use is blocked outside the common allowed hours");
        TimePolicy debug = new TimePolicy(); debug.external = true; debug.limitsSuspended = true;
        debug.tick(now, 1000); debug.usedMs = 1200; debug.sessionMs = 500; debug.tick(now + 30000, 31000);
        check(debug.usedMs == 1200 && debug.sessionMs == 500 && debug.reason(now + 30000).isEmpty(), "existing debug suspension is preserved for controlled apps");
        debug.limitsSuspended = false; debug.tick(now + 40000, 41000);
        check(debug.usedMs == 11200, "restoring normal control does not charge suspended time");

        AppControlSession session = new AppControlSession("launcher");
        session.transientPackages.add("keyboard"); session.observe("controlled", "PlayerActivity");
        check(session.controlled(true, true, false), "configured foreground app is controlled");
        for (String pkg : new String[]{"com.android.systemui", "keyboard"}) session.observe(pkg, "Overlay");
        session.observe("other", "android.widget.PopupWindow");
        check(session.foreground.equals("controlled"), "volume, IME and popup events do not discard the active app");
        check(!session.controlled(true, false, false), "screen off stops controlled timing");
        check(!session.controlled(true, true, true), "explicit parent permission setup remains reachable");
        session.observe("unmanaged", "Activity"); check(!session.controlled(false, true, false), "unmanaged foreground is never intercepted");
        session.observe("launcher", "MainActivity"); check(!session.controlled(true, true, false), "returning to the launcher stops external counting");
        check(!session.observe(null, "Activity"), "unknown foreground cannot create a new restriction");
        System.out.println("AppControlTime: " + checks + " shared-time and foreground behavior checks passed");
    }
}
