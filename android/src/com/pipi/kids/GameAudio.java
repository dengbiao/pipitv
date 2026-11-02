package com.pipi.kids;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashSet;
import org.json.JSONObject;

/** Offline English prompts on televisions without a system TTS engine. */
final class GameAudio {
    interface Listener { void finished(String status); }
    private final Context context;
    private final AudioManager manager;
    private final HashSet<String> allowed = new HashSet<>();
    private MediaPlayer player;
    private AudioManager.OnAudioFocusChangeListener focus;
    private String id = "", state = "idle";
    private int starts;
    private Listener listener;
    GameAudio(Context context) {
        this.context = context; manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        try (InputStream in = context.getAssets().open("web/game-audio/captions.json"); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            java.util.Iterator<String> keys = new JSONObject(out.toString("UTF-8")).keys();
            while (keys.hasNext()) allowed.add(keys.next());
        } catch (Exception ignored) {}
    }
    boolean accepts(String id) { return allowed.contains(id); }
    void play(String clip, Listener done) {
        stop(); if (!accepts(clip)) { done.finished("error"); return; } id = clip; state = "preparing"; listener = done;
        MediaPlayer current = new MediaPlayer(); player = current;
        try (AssetFileDescriptor asset = context.getAssets().openFd("web/game-audio/" + clip + ".m4a")) {
            current.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            current.setDataSource(asset.getFileDescriptor(), asset.getStartOffset(), asset.getLength());
            current.setOnPreparedListener(ready -> {
                if (player != ready) return;
                focus = change -> { if (change < 0) stop(); };
                if (manager.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { finish("error"); return; }
                try { ready.start(); starts++; state = "playing"; } catch (RuntimeException error) { finish("error"); }
            });
            current.setOnCompletionListener(ended -> { if (player == ended) finish("completed"); });
            current.setOnErrorListener((failed, what, extra) -> { if (player == failed) finish("error"); return true; });
            current.prepareAsync();
        } catch (Exception error) { finish("error"); }
    }
    private void finish(String status) {
        Listener done = listener; listener = null;
        if (player != null) { player.release(); player = null; }
        if (focus != null) { manager.abandonAudioFocus(focus); focus = null; }
        state = status;
        if (done != null) done.finished(status);
    }
    void stop() { finish("cancelled"); }
    String diagnostics() { return "id=" + id + " state=" + state + " starts=" + starts; }
}
