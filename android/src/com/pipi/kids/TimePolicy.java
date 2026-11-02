package com.pipi.kids;

import java.util.Calendar;

/** Time policy shared by the launcher and its native media player. No UI dependencies. */
public final class TimePolicy {
    public int dailyMinutes = 30, sessionMinutes = 15, restMinutes = 10, startHour = 8, endHour = 20;
    public String day = "";
    public long usedMs, sessionMs, extraMs, restUntil, lastMonotonic;
    public boolean learning, foreground, parent, external, limitsSuspended;

    public static String dayKey(long now) {
        Calendar c = Calendar.getInstance(); c.setTimeInMillis(now);
        return c.get(Calendar.YEAR) + "-" + (c.get(Calendar.MONTH) + 1) + "-" + c.get(Calendar.DAY_OF_MONTH);
    }
    public boolean allowed(long now) {
        Calendar c = Calendar.getInstance(); c.setTimeInMillis(now); int hour = c.get(Calendar.HOUR_OF_DAY);
        if (startHour == endHour) return true;
        return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
    }
    public void tick(long now, long monotonic) {
        long delta = lastMonotonic > 0 ? Math.max(0, monotonic - lastMonotonic) : 0;
        if (!dayKey(now).equals(day)) {
            Calendar midnight = Calendar.getInstance(); midnight.setTimeInMillis(now);
            midnight.set(Calendar.HOUR_OF_DAY, 0); midnight.set(Calendar.MINUTE, 0); midnight.set(Calendar.SECOND, 0); midnight.set(Calendar.MILLISECOND, 0);
            delta = Math.min(delta, Math.max(0, now - midnight.getTimeInMillis()));
            day = dayKey(now); usedMs = 0; sessionMs = 0; extraMs = 0; restUntil = 0;
        }
        lastMonotonic = monotonic;
        // Developer-only suspension preserves the parent's settings and budget.
        if (limitsSuspended) return;
        if (restUntil > 0 && restUntil <= now) { restUntil = 0; sessionMs = 0; learning = false; delta = 0; }
        if (((learning && foreground && !parent) || external) && restUntil == 0 && allowed(now)) {
            long spent = Math.max(0, Math.min(delta, Math.min(dailyRemaining(), sessionRemaining())));
            usedMs += spent; sessionMs += spent;
            if (sessionMs >= sessionMinutes * 60000L && dailyRemaining() > 0) restUntil = now + restMinutes * 60000L;
        }
    }
    public long dailyRemaining() { return Math.max(0, dailyMinutes * 60000L + extraMs - usedMs); }
    public long sessionRemaining() { return Math.max(0, sessionMinutes * 60000L - sessionMs); }
    public String reason(long now) {
        if (limitsSuspended) return "";
        if (!allowed(now)) return "schedule";
        if (dailyRemaining() <= 0) return "daily";
        if (restUntil > now) return "rest";
        if (sessionRemaining() <= 0) return "session";
        return "";
    }
    public long remaining(long now) { return limitsSuspended ? 86400000L : reason(now).isEmpty() ? Math.min(dailyRemaining(), sessionRemaining()) : 0; }
}
