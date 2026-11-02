import com.pipi.kids.TimePolicy;
import java.util.Calendar;

public final class TimePolicyTest {
    static long at(int day, int hour, int minute) { Calendar c = Calendar.getInstance(); c.set(2026, 9, day, hour, minute, 0); c.set(Calendar.MILLISECOND, 0); return c.getTimeInMillis(); }
    static void check(boolean condition, String description) { if (!condition) throw new AssertionError(description); }
    public static void main(String[] args) {
        TimePolicy p = new TimePolicy(); long now = at(31, 10, 0);
        p.dailyMinutes = 5; p.sessionMinutes = 1; p.learning = true; p.foreground = true;
        p.tick(now, 1000); p.tick(now + 120000, 121000);
        check(p.usedMs == 60000, "session limit clips elapsed time"); check(p.reason(now + 120000).equals("rest"), "session enters rest");
        long saved = p.usedMs; p.foreground = false; p.tick(now + 180000, 181000); check(p.usedMs == saved, "background does not consume");
        p.tick(now + 800000, 801000); check(p.sessionMs == 0, "rest ends");
        p.usedMs = 290000; p.foreground = true; p.learning = true; p.tick(now + 830000, 831000); check(p.usedMs == 300000, "daily cap clips time");
        check(p.reason(now + 830000).equals("daily"), "daily cap survives home/foreground changes");
        p.extraMs = 300000; p.learning = false; p.tick(at(1, 10, 0), 832000); check(p.usedMs == 0 && p.extraMs == 0, "new day resets only today");
        p.startHour = 20; p.endHour = 8; check(p.allowed(at(31, 23, 0)) && !p.allowed(at(31, 12, 0)), "overnight schedule");
        p.startHour = 0; p.endHour = 24; p.usedMs = 12345; p.tick(at(1, 10, 0), 831000); check(p.usedMs == 12345, "monotonic rollback never refunds");
        TimePolicy series = new TimePolicy(); series.dailyMinutes = 10; series.sessionMinutes = 1; series.learning = true; series.foreground = true;
        series.tick(now, 1000);
        for (int seconds : new int[]{20, 40, 61}) series.tick(now + seconds * 1000L, 1000 + seconds * 1000L);
        check(series.usedMs == 60000 && series.sessionMs == 60000, "successive episodes share the same session budget");
        check(series.reason(now + 61000).equals("rest") && series.remaining(now + 61000) == 0, "completion at the deadline cannot start another episode");
        TimePolicy debug = new TimePolicy(); debug.dailyMinutes = 5; debug.sessionMinutes = 1;
        debug.tick(now, 1000); debug.usedMs = 300000; debug.sessionMs = 60000; debug.restUntil = now + 120000;
        debug.learning = true; debug.foreground = true; debug.limitsSuspended = true;
        debug.tick(now + 30000, 31000);
        check(debug.reason(now + 30000).isEmpty() && debug.remaining(now + 30000) > 0, "debug suspension bypasses exhausted budgets and active rest");
        check(debug.usedMs == 300000 && debug.sessionMs == 60000 && debug.restUntil == now + 120000, "debug playback preserves normal budgets and rest state");
        debug.limitsSuspended = false;
        check(debug.reason(now + 30000).equals("daily"), "restoring debug suspension immediately enforces the original daily allowance");
        debug.usedMs = 1000;
        check(debug.reason(now + 30000).equals("rest"), "restoring debug suspension also restores an active rest");
        debug.tick(now + 150000, 151000);
        check(debug.sessionMs == 0 && debug.restUntil == 0, "expired rests settle normally after debugging");
        debug.usedMs = 2000; debug.sessionMs = 3000; debug.limitsSuspended = true;
        debug.tick(at(1, 10, 0), 181000);
        check(debug.usedMs == 0 && debug.sessionMs == 0, "debug suspension retains local-day rollover");
        System.out.println("TimePolicy: 17 behavior checks passed");
    }
}
