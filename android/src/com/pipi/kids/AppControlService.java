package com.pipi.kids;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import org.json.JSONObject;
import java.lang.ref.WeakReference;

/** User-enabled, package-only foreground observer for the shared parental budget. */
public final class AppControlService extends AccessibilityService {
    private static volatile WeakReference<AppControlService> live = new WeakReference<>(null);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Guard guard;
    private TvApps apps;
    private AppControlSession session;
    private AudioManager audio;
    private volatile boolean connected;
    private boolean holdingAudio;
    private long lastBlockAt;
    private String lastBlockedPackage = "";
    private final AudioManager.OnAudioFocusChangeListener audioFocus = change -> {};
    private final Runnable heartbeat = this::reconcile;
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { reconcile(); }
    };

    static boolean enabled(Context context) {
        AccessibilityManager manager = (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
        ComponentName wanted = new ComponentName(context, AppControlService.class);
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            ComponentName candidate = ComponentName.unflattenFromString(info.getId());
            if (wanted.equals(candidate)) return true;
        }
        return false;
    }

    static boolean ready(Context context) {
        AppControlService service = live.get();
        return service != null && service.connected && service.getPackageName().equals(context.getPackageName()) && enabled(context);
    }

    static JSONObject status(Context context) throws Exception {
        return new JSONObject().put("supported", true).put("enabled", enabled(context)).put("ready", ready(context))
            .put("managedCount", new TvApps(context).managedCount()).put("limitsSuspended", Guard.get(context).policy.limitsSuspended);
    }

    static Intent permissionIntent(Context context) {
        return new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
    }

    static void allowParentSettings(Context context, Intent intent) {
        ComponentName settings = intent.resolveActivity(context.getPackageManager());
        if (settings == null) return;
        // Only an explicitly opened parent permission screen is exempt, for three minutes.
        context.getSharedPreferences("pipikids-app-control", MODE_PRIVATE).edit()
            .putString("parentSettingsPackage", settings.getPackageName())
            .putLong("parentSettingsAt", System.currentTimeMillis()).apply();
    }

    static void configurationChanged(Context context) {
        AppControlService service = live.get();
        if (service != null && service.getPackageName().equals(context.getPackageName())) service.handler.post(service.heartbeat);
    }

    static void clearParentSettings(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("pipikids-app-control", MODE_PRIVATE);
        if (prefs.contains("parentSettingsPackage")) prefs.edit().remove("parentSettingsPackage").remove("parentSettingsAt").apply();
    }

    @Override protected void onServiceConnected() {
        super.onServiceConnected();
        guard = Guard.get(this); apps = new TvApps(this); session = new AppControlSession(getPackageName());
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        InputMethodManager inputs = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        for (InputMethodInfo info : inputs.getEnabledInputMethodList()) session.transientPackages.add(info.getPackageName());
        connected = true; live = new WeakReference<>(this);
        IntentFilter filter = new IntentFilter(); filter.addAction(Intent.ACTION_SCREEN_ON); filter.addAction(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(screen, filter);
        // Wait for an actual window event; never infer which app was used before reconnection.
        guard.external(false);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!connected || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence name = event.getPackageName(), type = event.getClassName();
        if (session.observe(name == null ? null : name.toString(), type == null ? "" : type.toString())) reconcile();
    }

    private boolean parentSettingsExempt() {
        SharedPreferences prefs = getSharedPreferences("pipikids-app-control", MODE_PRIVATE);
        long age = System.currentTimeMillis() - prefs.getLong("parentSettingsAt", 0);
        return age >= 0 && age < 180000 && session.foreground.equals(prefs.getString("parentSettingsPackage", ""));
    }

    private void reconcile() {
        handler.removeCallbacks(heartbeat);
        if (!connected) return;
        try {
            boolean interactive = ((PowerManager) getSystemService(POWER_SERVICE)).isInteractive();
            boolean configured = apps.managed(session.foreground);
            boolean active = session.controlled(configured, interactive, parentSettingsExempt());
            guard.external(active);
            boolean blocked = guard.blocked();
            if (active && blocked) {
                guard.external(false);
                guard.leaveParent();
                long now = SystemClock.elapsedRealtime();
                if (now - lastBlockAt >= 700) {
                    lastBlockAt = now;
                    // If a vendor denied the first background launch without throwing,
                    // Home still removes the restricted app from the foreground.
                    if (session.foreground.equals(lastBlockedPackage)) performGlobalAction(GLOBAL_ACTION_HOME);
                    lastBlockedPackage = session.foreground;
                    if (!holdingAudio) holdingAudio = audio.requestAudioFocus(audioFocus, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
                    Intent rest = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra("pipiExternalRest", true);
                    try { startActivity(rest); }
                    catch (RuntimeException error) { performGlobalAction(GLOBAL_ACTION_HOME); }
                }
            } else {
                lastBlockedPackage = "";
                if (holdingAudio && ((!session.foreground.equals(getPackageName()) && !active) || !blocked)) {
                    audio.abandonAudioFocus(audioFocus); holdingAudio = false;
                }
            }
            if (interactive && (configured || holdingAudio)) handler.postDelayed(heartbeat, 500);
        } catch (Exception error) {
            guard.external(false);
            android.util.Log.e("PipiAppControl", "Application control could not evaluate the foreground app", error);
            handler.postDelayed(heartbeat, 1000);
        }
    }

    @Override public void onInterrupt() { /* No accessibility feedback or input capture. */ }
    private void close() {
        connected = false; handler.removeCallbacksAndMessages(null);
        if (guard != null) guard.external(false);
        if (audio != null && holdingAudio) audio.abandonAudioFocus(audioFocus);
        holdingAudio = false;
        if (live.get() == this) live = new WeakReference<>(null);
        try { unregisterReceiver(screen); } catch (IllegalArgumentException ignored) {}
    }
    @Override public boolean onUnbind(Intent intent) { close(); return super.onUnbind(intent); }
    @Override public void onDestroy() { close(); super.onDestroy(); }
}
