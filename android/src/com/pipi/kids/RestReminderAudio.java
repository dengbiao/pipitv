package com.pipi.kids;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.util.Log;

/** Bundled Mandarin recordings also work on TVs with no text-to-speech service. */
final class RestReminderAudio {
    private final Context context;
    private final AudioManager manager;
    private MediaPlayer player;
    private AudioManager.OnAudioFocusChangeListener focus;
    private String id = "", state = "idle";
    private int starts;

    RestReminderAudio(Context context) {
        this.context = context;
        manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    void play(String reminderId) {
        stop();
        if (reminderId == null || !reminderId.matches("[0-9]{2}")) return;
        id = reminderId; state = "preparing";
        MediaPlayer current = new MediaPlayer(); player = current;
        try (AssetFileDescriptor asset = context.getAssets().openFd("web/rest-audio/" + id + ".m4a")) {
            current.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            current.setDataSource(asset.getFileDescriptor(), asset.getStartOffset(), asset.getLength());
            current.setLooping(false);
            current.setOnPreparedListener(ready -> {
                if (player != ready) return;
                focus = change -> { if (change < 0) stop(); };
                if (manager.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { stop(); state = "focus-denied"; return; }
                try { ready.start(); starts++; state = "playing"; Log.i("PipiRestReminder", "start id=" + id); }
                catch (RuntimeException error) { fail(); }
            });
            current.setOnCompletionListener(done -> {
                if (player != done) return;
                stop(); state = "completed"; Log.i("PipiRestReminder", "completed id=" + id);
            });
            current.setOnErrorListener((failed, what, extra) -> { if (player == failed) fail(); return true; });
            current.prepareAsync();
        } catch (Exception error) { fail(); }
    }

    private void fail() { stop(); state = "error"; Log.w("PipiRestReminder", "failed id=" + id); }
    void stop() {
        if (player != null) { player.release(); player = null; state = "stopped"; }
        if (focus != null) { manager.abandonAudioFocus(focus); focus = null; }
    }
    String diagnostics() { return "id=" + id + " state=" + state + " starts=" + starts; }
}
