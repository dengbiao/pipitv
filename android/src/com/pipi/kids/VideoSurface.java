package com.pipi.kids;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.view.Surface;
import android.view.TextureView;

/** Fits videos at their original aspect ratio, with a crop for verified source recordings. */
final class VideoSurface extends TextureView implements TextureView.SurfaceTextureListener {
    private MediaPlayer player;
    private Surface surface;
    private Uri uri;
    private java.util.Map<String, String> headers = java.util.Collections.emptyMap();
    private boolean prepared;
    private float cropTop;
    private int videoWidth, videoHeight;
    private boolean buffering;
    private int bufferPercent, bufferCount;
    private long bufferingSince, bufferingMs;
    private MediaPlayer.OnPreparedListener onPrepared;
    private MediaPlayer.OnCompletionListener onCompletion;
    private MediaPlayer.OnErrorListener onError;
    private MediaPlayer.OnSeekCompleteListener onSeekComplete;
    private Runnable onFirstFrame;
    private boolean firstFrameDelivered;
    private void firstFrame() {
        if (prepared && player != null && !firstFrameDelivered && onFirstFrame != null) {
            firstFrameDelivered = true; onFirstFrame.run();
        }
    }

    VideoSurface(Context context) { super(context); setSurfaceTextureListener(this); }
    void setVideoURI(Uri value) { uri = value; if (isAvailable()) open(getSurfaceTexture()); }
    void setVideoURI(Uri value, java.util.Map<String, String> requestHeaders) { headers = requestHeaders; setVideoURI(value); }
    void setOnPreparedListener(MediaPlayer.OnPreparedListener value) { onPrepared = value; }
    void setOnCompletionListener(MediaPlayer.OnCompletionListener value) { onCompletion = value; }
    void setOnErrorListener(MediaPlayer.OnErrorListener value) { onError = value; }
    void setOnSeekCompleteListener(MediaPlayer.OnSeekCompleteListener value) { onSeekComplete = value; }
    void setOnFirstFrameListener(Runnable value) { onFirstFrame = value; }
    void setCropTop(float value) { cropTop = Math.max(0, Math.min(.15f, value)); transformVideo(); }
    float cropTop() { return cropTop; }
    boolean isPlaying() { return prepared && player != null && player.isPlaying(); }
    int getCurrentPosition() { return prepared && player != null ? player.getCurrentPosition() : 0; }
    int getDuration() { return prepared && player != null ? player.getDuration() : 0; }
    boolean isBuffering() { return buffering; }
    int bufferPercent() { return bufferPercent; }
    int bufferCount() { return bufferCount; }
    long bufferingMs() { return bufferingMs + (buffering ? android.os.SystemClock.elapsedRealtime() - bufferingSince : 0); }
    int decodedWidth() { return videoWidth; }
    int decodedHeight() { return videoHeight; }
    void start() { if (prepared && player != null) player.start(); }
    void pause() { if (isPlaying()) player.pause(); }
    void setVolume(float value) { if (player != null) player.setVolume(value, value); }
    private float playbackSpeed = 1;
    private boolean fastPreviewSupported = true;
    boolean setPlaybackSpeed(float value) {
        if (!prepared || player == null) return false;
        if (playbackSpeed == value) return true;
        if (android.os.Build.VERSION.SDK_INT < 23) return false;
        if (value != 1 && !fastPreviewSupported) return false;
        try {
            player.setPlaybackParams(new android.media.PlaybackParams().setSpeed(value).setPitch(1)
                .setAudioFallbackMode(android.media.PlaybackParams.AUDIO_FALLBACK_MODE_MUTE));
            playbackSpeed = value; return true;
        } catch (RuntimeException unsupported) { if (value != 1) fastPreviewSupported = false; return false; }
    }
    void seekBefore(int value) {
        if (!prepared || player == null) return;
        if (android.os.Build.VERSION.SDK_INT >= 26) player.seekTo((long) value, MediaPlayer.SEEK_PREVIOUS_SYNC);
        else player.seekTo(value);
    }
    void seekTo(int value) {
        if (!prepared || player == null) return;
        if (android.os.Build.VERSION.SDK_INT >= 26) player.seekTo((long) value, MediaPlayer.SEEK_CLOSEST);
        else player.seekTo(value);
    }
    void stopPlayback() { uri = null; release(); }

    private void open(SurfaceTexture texture) {
        if (uri == null || texture == null) return;
        release();
        try {
            surface = new Surface(texture); player = new MediaPlayer();
            player.setAudioStreamType(AudioManager.STREAM_MUSIC); player.setSurface(surface);
            player.setDataSource(getContext(), uri, headers);
            player.setOnVideoSizeChangedListener((media, width, height) -> { if (media != player) return; videoWidth = width; videoHeight = height; transformVideo(); });
            player.setOnPreparedListener(media -> {
                if (media != player) return;
                prepared = true; videoWidth = media.getVideoWidth(); videoHeight = media.getVideoHeight(); transformVideo();
                if (onPrepared != null) onPrepared.onPrepared(media);
            });
            player.setOnCompletionListener(media -> { if (media == player && onCompletion != null) onCompletion.onCompletion(media); });
            player.setOnSeekCompleteListener(media -> { if (media == player && onSeekComplete != null) onSeekComplete.onSeekComplete(media); });
            player.setOnInfoListener((media, what, extra) -> {
                if (media == player && what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) firstFrame();
                if (media == player && what == MediaPlayer.MEDIA_INFO_BUFFERING_START && !buffering) { buffering = true; bufferCount++; bufferingSince = android.os.SystemClock.elapsedRealtime(); }
                if (media == player && what == MediaPlayer.MEDIA_INFO_BUFFERING_END && buffering) { bufferingMs += android.os.SystemClock.elapsedRealtime() - bufferingSince; buffering = false; }
                return false;
            });
            player.setOnBufferingUpdateListener((media, percent) -> { if (media == player) bufferPercent = Math.max(0, Math.min(100, percent)); });
            player.setOnErrorListener((media, what, extra) -> { if (media != player) return true; prepared = false; if (onError != null) onError.onError(media, what, extra); return true; });
            player.prepareAsync();
        } catch (Exception error) { if (onError != null) onError.onError(player, MediaPlayer.MEDIA_ERROR_UNKNOWN, 0); else release(); }
    }
    private void transformVideo() {
        if (videoWidth <= 0 || videoHeight <= 0 || getWidth() <= 0 || getHeight() <= 0) return;
        int croppedRows = (int) Math.ceil(videoHeight * cropTop);
        double scale = cropTop > 0
            ? Math.max((double) getWidth() / videoWidth, (double) getHeight() / (videoHeight - croppedRows))
            : Math.min((double) getWidth() / videoWidth, (double) getHeight() / videoHeight);
        float width = (float) (videoWidth * scale), height = (float) (videoHeight * scale);
        Matrix matrix = new Matrix(); matrix.setScale(width / getWidth(), height / getHeight());
        matrix.postTranslate((getWidth() - width) / 2, cropTop > 0 ? (float) (-croppedRows * scale) : (getHeight() - height) / 2);
        setTransform(matrix);
    }
    private void release() {
        prepared = false;
        firstFrameDelivered = false;
        playbackSpeed = 1; fastPreviewSupported = true;
        buffering = false; bufferPercent = 0; bufferCount = 0; bufferingMs = 0;
        if (player != null) { player.release(); player = null; }
        if (surface != null) { surface.release(); surface = null; }
    }
    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) { open(texture); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) { transformVideo(); }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) { release(); return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) { firstFrame(); }
}
