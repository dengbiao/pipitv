package com.pipi.kids;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.ListView;
import android.widget.BaseAdapter;
import android.widget.Toast;
import android.view.ViewGroup;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** All media stays in this activity so parent time limits also stop playback. */
public final class MediaActivity extends Activity {
    private Guard guard;
    private PlaybackStore playback;
    private org.json.JSONObject seriesEntry;
    private String playbackMode = PlaybackPlanner.SPACED;
    private TextView episodeStatus;
    private long lastCheckpoint;
    private long startupRequestedAt, startupPreparationMs, createdAt, firstFrameAt;
    private void traceStartup(String event) {
        long now = android.os.SystemClock.elapsedRealtime();
        android.util.Log.i("PipiStartup", "player event=" + event + " activityMs=" + (now - createdAt) + " nativeMs=" + (now - startupRequestedAt)
            + " totalMs=" + (now - startupRequestedAt + startupPreparationMs));
    }
    private final PlaybackClock playbackClock = new PlaybackClock();
    private long pendingPlaybackMs;
    private boolean seeking;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView timer, title;
    private TextView elapsed, duration;
    private FrameLayout frame;
    private LinearLayout menu;
    private LinearLayout completionCard;
    private TextView playState;
    private LinearLayout menuActions;
    private Button episodeButton;
    private Button replayButton;
    private Button qualityButton;
    private AlertDialog qualityDialog;
    private String manualQuality, activeQuality = "";
    private boolean rememberRequestedQuality, qualityRetrying, playOnPrepared = true;
    private Boolean restartPlaying;
    private volatile int qualityFailure;
    private boolean renderingPausedFrame;
    private int resumeFrameTarget;
    private boolean previewRewindAttempted;
    private final Runnable finishFrame = this::finishPausedFrame;
    private FrameLayout episodeDrawer;
    private ListView episodeList;
    private boolean menuExpanded;
    private boolean confirmHeld;
    private View confirmTarget;
    private int confirmLayer, confirmEpisode;
    private volatile int previewGeneration;
    private volatile int mediaGeneration;
    private final java.util.concurrent.ExecutorService mediaRequests = java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService previews = java.util.concurrent.Executors.newSingleThreadExecutor();
    private SeekBar progress;
    private final List<File> episodes = new ArrayList<>();
    private int episodeIndex;
    private boolean resumePosition, completed;
    private volatile boolean resumed;
    private VideoSurface video;
    private MediaPlayer audio;
    private ImageView image;
    private PdfRenderer pdf;
    private ParcelFileDescriptor pdfFile;
    private int pageIndex;
    private String path, kind;
    private boolean ready, wasPlaying, historyRecorded, dragging, mediaError;
    private AudioManager audioManager;
    private AudioManager.OnAudioFocusChangeListener focusListener;
    private final Runnable hideMenu = () -> {
        if (!dragging && !completed && episodeDrawer == null && qualityDialog == null) {
            if (ready && !isPlaying()) showProgress(); else dismissMenu();
        }
    };
    private final Runnable heartbeat = new Runnable() { @Override public void run() {
        if (isFinishing()) return;
        checkpointPlayback(true);
        if (guard.blocked()) { stopForLimit(); return; }
        try {
            org.json.JSONObject access = guard.access();
            long seconds = (access.getLong("remainingMs") + 999) / 1000;
            timer.setText(access.optBoolean("limitsSuspended") ? "调试不限时" : String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60));
        } catch (Exception ignored) {}
        updateProgress();
        if (android.os.SystemClock.elapsedRealtime() - lastCheckpoint >= 2000) { savePosition(); lastCheckpoint = android.os.SystemClock.elapsedRealtime(); }
        handler.postDelayed(this, 500);
    }};
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); createdAt = android.os.SystemClock.elapsedRealtime();
        startupRequestedAt = getIntent().getLongExtra("startupRequestedAt", createdAt);
        startupPreparationMs = getIntent().getLongExtra("startupPreparationMs", 0);
        traceStartup("created"); guard = Guard.get(this); playback = PlaybackStore.get(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        path = getIntent().getStringExtra("path"); kind = Storage.kind(path == null ? "" : path);
        frame = new FrameLayout(this); frame.setBackgroundColor(Color.BLACK); frame.setFocusable(true); frame.setFocusableInTouchMode(true); setContentView(frame);
        title = label(getIntent().getStringExtra("title"), 20); title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        timer = label("", 17);
        try {
            Storage storage = new Storage(this);
            seriesEntry = guard.entry(getIntent().getStringExtra("entryId")); playbackMode = playback.mode(seriesEntry);
            File file = storage.childFile(path, guard); if (!new Storage(this).isFile(file)) throw new Exception("文件不存在，请检查内容来源。");
            if (!storage.belongsTo(file, seriesEntry)) throw new Exception("这个文件不在当前系列中。");
            guard.learning(true);
            loadEpisodes(file, storage);
            traceStartup("episodes-loaded");
            openMedia(file, true);
        } catch (Exception e) { showError(e.getMessage()); createMenu(); }
        frame.setOnClickListener(v -> { if (ready) { toggle(); showProgress(); } else toggleMenu(); }); frame.requestFocus();
    }
    private void loadEpisodes(File file, Storage storage) throws Exception {
        episodes.clear();
        if (kind.equals("video") || kind.equals("audio")) {
            try {
                episodes.addAll(storage.playableFiles(seriesEntry));
            } catch (Exception ignored) { episodes.clear(); }
        }
        episodeIndex = episodes.indexOf(file);
        if (episodeIndex < 0) { episodes.clear(); episodes.add(file); episodeIndex = 0; }
    }
    private void savePosition() {
        if (!ready || completed || renderingPausedFrame || seriesEntry == null || (video == null && audio == null)) return;
        int position = video != null ? video.getCurrentPosition() : audio.getCurrentPosition();
        int length = video != null ? video.getDuration() : audio.getDuration();
        getPreferences(MODE_PRIVATE).edit().putInt(path, position).apply();
        try { playback.progress(seriesEntry, path, position, length); } catch (Exception ignored) {}
    }
    private void checkpointPlayback(boolean active) {
        if (!ready || seriesEntry == null || (video == null && audio == null)) return;
        long position = video != null ? video.getCurrentPosition() : audio.getCurrentPosition();
        boolean playing = video != null ? video.isPlaying() : audio.isPlaying();
        pendingPlaybackMs += playbackClock.sample(android.os.SystemClock.elapsedRealtime(), position, active && resumed && playing && !seeking && !renderingPausedFrame);
        if (pendingPlaybackMs >= 2000 || (!active && pendingPlaybackMs > 0)) {
            try { playback.recordTime(seriesEntry, path, kind, pendingPlaybackMs); pendingPlaybackMs = 0; } catch (Exception ignored) {}
        }
    }
    private void seekComplete() {
        seeking = false;
        if (!ready || (video == null && audio == null)) return;
        finishPausedFrame();
        playbackClock.reset(android.os.SystemClock.elapsedRealtime(), video != null ? video.getCurrentPosition() : audio.getCurrentPosition(),
            resumed && !renderingPausedFrame && (video != null ? video.isPlaying() : audio.isPlaying()));
    }
    private int savedPosition() {
        if (!resumePosition) return 0;
        try { return playback.position(seriesEntry, path); } catch (Exception ignored) { return getPreferences(MODE_PRIVATE).getInt(path, 0); }
    }
    private void openMedia(File file, boolean resume) throws Exception {
        if (guard.blocked()) { stopForLimit(); return; }
        if (qualityDialog != null) qualityDialog.dismiss();
        String nextPath = file.getCanonicalPath();
        if (!nextPath.equals(path)) { activeQuality = ""; qualityRetrying = false; }
        playOnPrepared = restartPlaying == null || restartPlaying; restartPlaying = null;
        savePosition(); stopMedia(); frame.removeAllViews();
        previewGeneration++; episodeDrawer = null; episodeList = null; menuExpanded = false;
        menu = null; completionCard = null; playState = null; episodeButton = null; replayButton = null; qualityButton = null; progress = null; elapsed = null; duration = null;
        mediaError = false; historyRecorded = false; completed = false; wasPlaying = false; dragging = false; pageIndex = 0;
        firstFrameAt = 0; lastCheckpoint = android.os.SystemClock.elapsedRealtime();
        resumePosition = resume; path = nextPath; kind = Storage.kind(path);
        getIntent().putExtra("path", path);
        if (!resume) getIntent().putExtra("title", new Storage(this).name(file));
        title = label(getIntent().getStringExtra("title"), 20); title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        timer = label("", 17);
        try {
            if (BaiduPolicy.cloud(path)) { openCloud(file); createMenu(); dismissMenu(); return; }
            switch (kind) {
                case "video": openVideo(file); break;
                case "audio": openAudio(file); break;
                case "image": openImage(file); break;
                case "pdf": openPdf(file); break;
                default: throw new Exception("暂不支持这个文件格式。");
            }
        } catch (Exception e) { showError(e.getMessage()); }
        createMenu(); dismissMenu();
    }
    private void stopForLimit() { savePosition(); stopMedia(); try { guard.learning(false); } catch (Exception ignored) {} setResult(RESULT_FIRST_USER); finish(); }
    private boolean selectEpisode(int next) {
        if (guard.blocked()) { stopForLimit(); return false; }
        if (next < 0 || next >= episodes.size()) return false;
        try {
            File file = new Storage(this).childFile(episodes.get(next).getPath(), guard);
            if (!new Storage(this).isFile(file)) throw new Exception("文件不存在，请检查内容来源。");
            episodeIndex = next; openMedia(file, false); return true;
        } catch (Exception e) { showError(e.getMessage()); return false; }
    }
    private void completeEpisode() {
        if (completed) return;
        checkpointPlayback(false);
        completed = true; getPreferences(MODE_PRIVATE).edit().remove(path).apply();
        try { playback.complete(seriesEntry, path); } catch (Exception e) { showError(e.getMessage()); return; }
        if (guard.blocked()) { stopForLimit(); return; }
        try {
            Storage storage = new Storage(this);
            org.json.JSONObject plan = playback.plan(seriesEntry, storage, false);
            String next = plan.optString("path");
            if (!next.isEmpty()) {
                File file = storage.childFile(next, guard); episodeIndex = episodes.indexOf(file);
                openMedia(file, plan.optString("reason").equals("resume")); return;
            }
            showCompletion(PlaybackPlanner.SPACED.equals(playbackMode) ? "今天的复习完成啦" : "这个系列播完啦");
        } catch (Exception e) { showError(e.getMessage()); }
    }
    private void showCompletion(String message) {
        handler.removeCallbacks(hideMenu);
        if (episodeStatus != null) episodeStatus.setText(message);
        if (replayButton != null) replayButton.setVisibility(View.VISIBLE);
        completionCard = new LinearLayout(this); completionCard.setOrientation(LinearLayout.VERTICAL); completionCard.setGravity(Gravity.CENTER);
        completionCard.setPadding(dp(36), dp(24), dp(36), dp(230));
        completionCard.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xff303e2a, 0xff20291d}));
        completionCard.setContentDescription("播放完成");
        TextView heading = label(message, 30); heading.setGravity(Gravity.CENTER); completionCard.addView(heading);
        TextView hint = label("可以重新播放或选集，按返回键逐层退出。", 17); hint.setGravity(Gravity.CENTER); hint.setTextColor(0xffafbba5); hint.setPadding(0, dp(16), 0, 0); completionCard.addView(hint);
        frame.addView(completionCard, Math.max(0, frame.indexOfChild(menu)), new FrameLayout.LayoutParams(-1, -1));
        showMenu();
    }
    private void immersive() { getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION); }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) immersive(); else confirmHeld = false; }
    private TextView label(String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextColor(Color.WHITE); view.setTextSize(size); view.setGravity(Gravity.CENTER_VERTICAL); return view; }
    private Button button(String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setTextSize(17); button.setAllCaps(false);
        button.setPadding(dp(16), 0, dp(16), 0);
        button.setOnFocusChangeListener((v, focused) -> {
            GradientDrawable background = new GradientDrawable(); background.setColor(focused ? Color.WHITE : 0x28ffffff); background.setCornerRadius(dp(10));
            if (focused) background.setStroke(dp(2), 0xff5d754e);
            background.setColor(focused ? 0xffd0dac6 : 0x20ffffff);
            button.setBackground(background); button.setTextColor(focused ? 0xff35492e : Color.WHITE);
        });
        GradientDrawable background = new GradientDrawable(); background.setColor(0x28ffffff); background.setCornerRadius(dp(10)); button.setBackground(background); button.setTextColor(Color.WHITE);
        button.setOnClickListener(v -> { action.run(); scheduleHide(); }); return button;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void addAction(LinearLayout row, Button action) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(44)); params.rightMargin = dp(14); row.addView(action, params);
    }
    private void createMenu() {
        if (kind.equals("video") || kind.equals("audio")) title.setText(new Storage(this).name(new File(path)).replaceFirst("\\.[^.]+$", ""));
        menu = new LinearLayout(this); menu.setOrientation(LinearLayout.VERTICAL); menu.setPadding(dp(36), dp(40), dp(36), dp(20));
        menu.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0x00000000, 0xdf000000, 0xf2000000}));
        LinearLayout info = new LinearLayout(this); info.setGravity(Gravity.CENTER_VERTICAL);
        info.addView(title, new LinearLayout.LayoutParams(0, dp(36), 1));
        info.addView(label("剩余可用  ", 15)); info.addView(timer); menu.addView(info);
        if (kind.equals("video") || kind.equals("audio")) {
            LinearLayout timeline = new LinearLayout(this); timeline.setGravity(Gravity.CENTER_VERTICAL); timeline.setPadding(0, dp(10), 0, dp(10));
            playState = label("播放中", 15); timeline.addView(playState, new LinearLayout.LayoutParams(dp(80), dp(36)));
            elapsed = label("00:00", 16); timeline.addView(elapsed, new LinearLayout.LayoutParams(dp(64), dp(44)));
            progress = new SeekBar(this); progress.setContentDescription("播放进度"); progress.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.WHITE)); progress.setThumbTintList(android.content.res.ColorStateList.valueOf(Color.WHITE));
            progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                public void onProgressChanged(SeekBar bar, int value, boolean fromUser) { if (fromUser) { seekTo(value); scheduleHide(); } }
                public void onStartTrackingTouch(SeekBar bar) { dragging = true; handler.removeCallbacks(hideMenu); }
                public void onStopTrackingTouch(SeekBar bar) { dragging = false; scheduleHide(); }
            });
            timeline.addView(progress, new LinearLayout.LayoutParams(0, dp(44), 1));
            duration = label("00:00", 16); duration.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL); timeline.addView(duration, new LinearLayout.LayoutParams(dp(64), dp(44))); menu.addView(timeline);
            String modeText = PlaybackPlanner.modeLabel(playbackMode) + (PlaybackPlanner.SPACED.equals(playbackMode) ? " · 到期内容优先" : "");
            episodeStatus = label(String.format(Locale.ROOT, "第 %d / %d 集    %s", episodeIndex + 1, episodes.size(), modeText), 15);
            episodeStatus.setTextColor(0xffafbba5); menu.addView(episodeStatus, 1, new LinearLayout.LayoutParams(-1, dp(25)));
        }
        LinearLayout actions = new LinearLayout(this); actions.setGravity(Gravity.CENTER_VERTICAL); actions.setPadding(0, dp(8), 0, 0);
        menuActions = actions;
        if (kind.equals("video") || kind.equals("audio")) {
            episodeButton = button(String.format(Locale.ROOT, "选集  %d / %d", episodeIndex + 1, episodes.size()), this::showEpisodes);
            addAction(actions, episodeButton);
        }
        if (kind.equals("video") || kind.equals("audio")) {
            replayButton = button("重新播放", () -> { toggle(); showProgress(); }); replayButton.setVisibility(View.GONE); addAction(actions, replayButton);
        }
        if (kind.equals("video") && BaiduPolicy.cloud(path)) {
            qualityButton = button("清晰度：" + BaiduStream.label(activeQuality.isEmpty() ? preferredQuality() : activeQuality), this::showQuality);
            qualityButton.setEnabled(ready || mediaError); addAction(actions, qualityButton);
        }
        if (kind.equals("pdf")) { addAction(actions, button("‹ 上一页", () -> page(-1))); addAction(actions, button("下一页 ›", () -> page(1))); }
        if (!kind.equals("video") && !kind.equals("audio")) addAction(actions, button("收起", this::dismissMenu));
        TextView hint = label("OK 确认    返回 收起菜单", 14); hint.setTextColor(0xffbdbdbd); hint.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL); actions.addView(hint, new LinearLayout.LayoutParams(0, dp(44), 1));
        menu.addView(actions); menu.setVisibility(View.INVISIBLE); frame.addView(menu, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
    }
    private boolean controlsVisible() { return menu != null && menu.getVisibility() == View.VISIBLE; }
    private boolean menuVisible() { return controlsVisible() && menuExpanded; }
    private boolean isPlaying() { return ready && !renderingPausedFrame && (video != null ? video.isPlaying() : audio != null && audio.isPlaying()); }
    private void toggleMenu() { if (episodeDrawer != null || menuVisible()) dismissMenu(); else showMenu(); }
    private void showProgress() {
        if (menu == null || mediaError) return;
        closeEpisodes(false); menuExpanded = false; menuActions.setVisibility(View.GONE);
        if (progress != null) { progress.setFocusable(false); progress.setFocusableInTouchMode(false); }
        menu.setVisibility(View.VISIBLE); menu.setAlpha(1); menu.setTranslationY(0); updateProgress(); frame.requestFocus(); scheduleHide();
    }
    private void showMenu() {
        if (menu == null) return;
        boolean opening = !menuVisible(); closeEpisodes(false); menuExpanded = true; menuActions.setVisibility(View.VISIBLE);
        if (progress != null) progress.setFocusable(true);
        menu.animate().cancel(); menu.setVisibility(View.VISIBLE); updateProgress();
        if (opening) {
            menu.setTranslationY(dp(40)); menu.setAlpha(0); menu.animate().translationY(0).alpha(1).setDuration(180).start();
            if (completed && replayButton != null) replayButton.requestFocus(); else if (episodeButton != null) episodeButton.requestFocus(); else menuActions.getChildAt(0).requestFocus();
        }
        scheduleHide();
    }
    private void scheduleHide() { handler.removeCallbacks(hideMenu); if (controlsVisible() && episodeDrawer == null && qualityDialog == null && !dragging && !completed && (menuExpanded || isPlaying())) handler.postDelayed(hideMenu, 5000); }
    private String preferredQuality() { return BaiduStream.quality(getSharedPreferences("pipikids-cloud-playback", MODE_PRIVATE).getString("quality", BaiduStream.DEFAULT)); }
    private void showQuality() {
        if (!BaiduPolicy.cloud(path) || !kind.equals("video") || qualityDialog != null) return;
        handler.removeCallbacks(hideMenu); String current = activeQuality.isEmpty() ? preferredQuality() : activeQuality;
        String[] labels = new String[BaiduStream.QUALITIES.length]; int checked = 0;
        for (int i = 0; i < labels.length; i++) { labels[i] = BaiduStream.label(BaiduStream.QUALITIES[i]); if (BaiduStream.QUALITIES[i].equals(current)) checked = i; }
        qualityDialog = new AlertDialog.Builder(this).setTitle("视频清晰度").setSingleChoiceItems(labels, checked, (dialog, index) -> {
            String selected = BaiduStream.QUALITIES[index]; dialog.dismiss();
            if (!selected.equals(activeQuality) || !ready) switchQuality(selected);
        }).setNegativeButton("取消", (dialog, which) -> dialog.dismiss()).create();
        qualityDialog.setOnDismissListener(dialog -> { qualityDialog = null; if (qualityButton != null && controlsVisible()) qualityButton.requestFocus(); scheduleHide(); });
        qualityDialog.show(); qualityDialog.getListView().setSelection(checked); qualityDialog.getListView().requestFocus();
    }
    private void switchQuality(String quality) {
        if (guard.blocked()) { stopForLimit(); return; }
        try {
            File file = new Storage(this).childFile(path, guard);
            restartPlaying = ready ? isPlaying() : playOnPrepared;
            manualQuality = BaiduStream.quality(quality); rememberRequestedQuality = true; qualityRetrying = false; qualityFailure = 0;
            openMedia(file, true); showProgress();
        } catch (Exception error) { showError("暂时无法切换清晰度，请返回后重试。"); }
    }
    private void dismissMenu() { handler.removeCallbacks(hideMenu); closeEpisodes(false); menuExpanded = false; if (menu != null) { menu.animate().cancel(); menu.setVisibility(View.INVISIBLE); } frame.requestFocus(); immersive(); }
    private GradientDrawable rounded(int color) {
        GradientDrawable background = new GradientDrawable(); background.setColor(color); background.setCornerRadius(dp(7)); return background;
    }
    private void closeEpisodes(boolean restoreMenu) {
        if (episodeDrawer == null) return;
        previewGeneration++; frame.removeView(episodeDrawer); episodeDrawer = null; episodeList = null;
        if (restoreMenu) showMenu();
    }
    private void showEpisodes() {
        if (episodes.isEmpty()) return;
        handler.removeCallbacks(hideMenu); if (menu != null) menu.setVisibility(View.INVISIBLE); menuExpanded = false;
        episodeDrawer = new FrameLayout(this); episodeDrawer.setBackgroundColor(0xf5222b1e);
        LinearLayout pane = new LinearLayout(this); pane.setOrientation(LinearLayout.VERTICAL); pane.setPadding(dp(24), dp(24), dp(24), dp(18));
        episodeDrawer.addView(pane, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout heading = new LinearLayout(this); heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = label("选集   共 " + episodes.size() + " 集", 24); heading.addView(name, new LinearLayout.LayoutParams(0, dp(40), 1));
        Button close = button("关闭", () -> closeEpisodes(true)); heading.addView(close, new LinearLayout.LayoutParams(dp(68), dp(40))); pane.addView(heading);
        TextView series = label(seriesEntry.optString("title"), 14); series.setTextColor(0xffafbba5); series.setPadding(0, dp(4), 0, dp(16)); pane.addView(series);
        episodeList = new ListView(this); episodeList.setDivider(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)); episodeList.setDividerHeight(dp(6));
        episodeList.setCacheColorHint(Color.TRANSPARENT); episodeList.setItemsCanFocus(false); episodeList.setDrawSelectorOnTop(true);
        GradientDrawable selector = rounded(0x0c5d754e); selector.setStroke(dp(2), 0xff5d754e); episodeList.setSelector(selector);
        episodeList.setContentDescription("选集列表"); episodeList.setAdapter(new EpisodeAdapter(++previewGeneration));
        episodeList.setOnItemClickListener((parent, view, index, id) -> {
            if (index == episodeIndex) dismissMenu(); else selectEpisode(index);
        });
        episodeList.setOnKeyListener((view, key, event) -> (key == KeyEvent.KEYCODE_DPAD_UP && episodeList.getSelectedItemPosition() == 0)
            || (key == KeyEvent.KEYCODE_DPAD_DOWN && episodeList.getSelectedItemPosition() == episodes.size() - 1));
        pane.addView(episodeList, new LinearLayout.LayoutParams(-1, 0, 1));
        TextView hint = label("↑ ↓ 选择    OK 播放    返回 收起", 14); hint.setTextColor(0xffafbba5); hint.setPadding(0, dp(14), 0, 0); pane.addView(hint);
        frame.addView(episodeDrawer, new FrameLayout.LayoutParams(Math.round(getResources().getDisplayMetrics().widthPixels * .44f), -1, Gravity.RIGHT));
        episodeList.requestFocus(); episodeList.setSelection(episodeIndex);
    }
    private final class EpisodeAdapter extends BaseAdapter {
        private final int generation;
        EpisodeAdapter(int generation) { this.generation = generation; }
        public int getCount() { return episodes.size(); }
        public Object getItem(int index) { return episodes.get(index); }
        public long getItemId(int index) { return index; }
        public View getView(int index, View recycled, ViewGroup parent) {
            File file = episodes.get(index); boolean current = index == episodeIndex;
            LinearLayout row = new LinearLayout(MediaActivity.this); row.setGravity(Gravity.CENTER_VERTICAL); row.setPadding(dp(8), dp(8), dp(8), dp(8));
            row.setBackground(rounded(current ? 0x0dffffff : Color.TRANSPARENT));
            row.setLayoutParams(new android.widget.AbsListView.LayoutParams(-1, dp(106)));
            row.setContentDescription("第 " + (index + 1) + " 集 " + new Storage(MediaActivity.this).name(file) + (current ? "，正在播放" : ""));
            FrameLayout art = new FrameLayout(MediaActivity.this); art.setBackground(rounded(0xff131a10));
            ImageView thumbnail = new ImageView(MediaActivity.this); thumbnail.setScaleType(ImageView.ScaleType.FIT_CENTER); art.addView(thumbnail, new FrameLayout.LayoutParams(-1, -1));
            TextView placeholder = label("读取预览…", 12); placeholder.setGravity(Gravity.CENTER); placeholder.setTextColor(0xff8c9b81); art.addView(placeholder, new FrameLayout.LayoutParams(-1, -1));
            TextView length = label("", 11); length.setBackgroundColor(0xbb000000); length.setPadding(dp(4), 0, dp(4), 0);
            FrameLayout.LayoutParams badge = new FrameLayout.LayoutParams(-2, dp(20), Gravity.RIGHT | Gravity.BOTTOM); badge.setMargins(0, 0, dp(4), dp(4)); art.addView(length, badge); length.setVisibility(View.GONE);
            row.addView(art, new LinearLayout.LayoutParams(dp(132), dp(74)));
            LinearLayout copy = new LinearLayout(MediaActivity.this); copy.setOrientation(LinearLayout.VERTICAL); copy.setGravity(Gravity.CENTER_VERTICAL); copy.setPadding(dp(14), 0, 0, 0);
            TextView number = label("第 " + (index + 1) + " 集" + (current ? "   正在播放" : ""), 12); number.setTextColor(current ? 0xffc0d2ad : 0xffafbba5); copy.addView(number);
            TextView name = label(new Storage(MediaActivity.this).name(file).replaceFirst("\\.[^.]+$", ""), 17); name.setMaxLines(2); name.setEllipsize(android.text.TextUtils.TruncateAt.END); name.setTypeface(null, android.graphics.Typeface.BOLD); copy.addView(name);
            String topic = MediaTopics.summary(MediaActivity.this, new Storage(MediaActivity.this).name(file), file.length());
            if (!topic.isEmpty()) { TextView detail = label(topic, 12); detail.setTextColor(0xffafbba5); detail.setSingleLine(true); detail.setEllipsize(android.text.TextUtils.TruncateAt.END); copy.addView(detail); }
            row.addView(copy, new LinearLayout.LayoutParams(0, -1, 1));
            previews.execute(() -> {
                if (generation != previewGeneration) return;
                EpisodePreview result = null; Bitmap bitmap = null;
                try {
                    result = EpisodePreview.load(getApplicationContext(), file);
                    if (result.image != null) bitmap = BitmapFactory.decodeFile(result.image.getPath());
                } catch (Exception ignored) {}
                final EpisodePreview loaded = result; final Bitmap picture = bitmap;
                handler.post(() -> {
                    if (generation != previewGeneration || isFinishing()) { if (picture != null) picture.recycle(); return; }
                    if (picture != null) { thumbnail.setImageBitmap(picture); placeholder.setVisibility(View.GONE); } else placeholder.setText("暂无预览");
                    if (loaded != null && loaded.durationMs > 0) { length.setText(mediaTime(loaded.durationMs)); length.setVisibility(View.VISIBLE); }
                });
            });
            return row;
        }
    }
    private static String mediaTime(int millis) { long seconds = Math.max(0, millis) / 1000; return seconds >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60); }
    private void updateProgress() {
        if (!ready || progress == null || !controlsVisible()) return;
        int position = renderingPausedFrame ? resumeFrameTarget : video != null ? video.getCurrentPosition() : audio != null ? audio.getCurrentPosition() : 0;
        int length = video != null ? video.getDuration() : audio != null ? audio.getDuration() : 0;
        boolean playing = isPlaying();
        playState.setText(video != null && video.isBuffering() ? "缓冲中…" : renderingPausedFrame ? "正在准备播放…" : playing ? "播放中" : completed ? "已播完" : "已暂停");
        elapsed.setText(mediaTime(position)); duration.setText(mediaTime(length));
        if (!dragging) { progress.setMax(Math.max(1, length)); progress.setKeyProgressIncrement(10000); progress.setProgress(position); }
    }
    private void recordPlayed() {
        if (historyRecorded) return;
        try {
            if (kind.equals("video") || kind.equals("audio")) playback.start(seriesEntry, path, new Storage(this), !resumePosition);
            guard.recordPlayed(getIntent().getStringExtra("entryId"), path, new Storage(this)); historyRecorded = true;
        }
        catch (Exception ignored) {}
    }
    private void requestAudioFocus() {
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        focusListener = change -> { if (change <= AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) { if (renderingPausedFrame && resumed) playOnPrepared = false; pause(); } };
        audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
    }
    private void openVideo(File file) { openVideo(file, Uri.fromFile(file)); }
    private void openVideo(File file, Uri source) {
        openVideo(file, source, "original", false, "");
    }
    private void openVideo(File file, Uri source, String quality, boolean remember, String notice) {
        requestAudioFocus(); video = new VideoSurface(this); frame.addView(video, new FrameLayout.LayoutParams(-1, -1));
        video.setCropTop(recordingCropTop(file));
        video.setOnTouchListener((view, event) -> { if (event.getAction() == android.view.MotionEvent.ACTION_UP) view.performClick(); return true; });
        video.setOnClickListener(view -> { toggle(); showProgress(); });
        VideoSurface currentVideo = video;
        final String previousPreference = preferredQuality();
        video.setOnPreparedListener(player -> {
            if (video != currentVideo) return;
            traceStartup("prepared"); ready = true;
            if (BaiduPolicy.cloud(path)) {
                activeQuality = quality;
                if (qualityButton != null) { qualityButton.setEnabled(true); qualityButton.setText("清晰度：" + BaiduStream.label(quality)); }
                if (remember) getSharedPreferences("pipikids-cloud-playback", MODE_PRIVATE).edit().putString("quality", quality).apply();
            }
            int saved = savedPosition(); resumeFrameTarget = saved > 0 && saved < player.getDuration() - 500 ? saved : 0;
            if (resumeFrameTarget > 0) { seeking = true; video.seekTo(resumeFrameTarget); }
            if (guard.blocked()) { stopForLimit(); return; }
            if (resumed && ((!playOnPrepared) || (BaiduPolicy.cloud(path) && resumeFrameTarget > 0))) renderPausedFrame();
            else if (resumed && playOnPrepared) { video.start(); checkpointPlayback(true); }
            else { wasPlaying = playOnPrepared; if (resumed && !playOnPrepared) renderPausedFrame(); }
        });
        video.setOnFirstFrameListener(() -> {
            if (video != currentVideo) return;
            if (firstFrameAt == 0 && !notice.isEmpty()) Toast.makeText(this, notice, Toast.LENGTH_LONG).show();
            firstFrameAt = android.os.SystemClock.elapsedRealtime(); traceStartup("first-frame");
            finishPausedFrame();
            if (BaiduPolicy.cloud(path)) {
                activeQuality = quality;
                if (qualityButton != null) qualityButton.setText("清晰度：" + BaiduStream.label(quality));
            }
            if (resumed && playOnPrepared && !renderingPausedFrame) recordPlayed();
        });
        video.setOnCompletionListener(player -> {
            if (video != currentVideo) return;
            if (firstFrameAt == 0 || renderingPausedFrame) { showError("视频暂时无法定位到原进度，请返回后重试。"); return; }
            completeEpisode();
        });
        video.setOnSeekCompleteListener(player -> { if (video == currentVideo) seekComplete(); });
        video.setOnErrorListener((player, what, extra) -> {
            if (video != currentVideo) return true;
            if (remember) getSharedPreferences("pipikids-cloud-playback", MODE_PRIVATE).edit().putString("quality", previousPreference).apply();
            if (BaiduPolicy.cloud(path) && !quality.equals("original") && !qualityRetrying) {
                qualityFailure = extra;
                qualityRetrying = true;
                handler.post(() -> {
                    if (video != currentVideo || isFinishing()) return;
                    try { manualQuality = "original"; rememberRequestedQuality = false; restartPlaying = playOnPrepared; openMedia(file, true); Toast.makeText(this, "转码播放暂不可用，正在恢复原画。", Toast.LENGTH_LONG).show(); }
                    catch (Exception ignored) { showError("网盘视频暂时无法播放，请返回重试。"); }
                });
            } else showError(BaiduPolicy.cloud(path) ? "网盘视频暂时无法播放，请检查网络后返回重试。" : "当前电视暂时不能播放这个视频的编码。\n你可以尝试 MP4（H.264）版本。");
            return true;
        });
        video.setVideoURI(source, BaiduPolicy.cloud(path) ? java.util.Collections.singletonMap("User-Agent", quality.equals("original") ? "pan.baidu.com" : BaiduStream.userAgent(android.os.Build.VERSION.RELEASE)) : java.util.Collections.emptyMap());
        traceStartup("video-open");
    }
    private float recordingCropTop(File file) {
        try (java.io.InputStream input = getAssets().open("web/recording-crops.json")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream(); byte[] bytes = new byte[1024]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
            org.json.JSONArray recordings = new org.json.JSONObject(output.toString("UTF-8")).getJSONArray("recordings");
            Storage storage = new Storage(this); String name = storage.name(file); long size = storage.size(file);
            for (int i = 0; i < recordings.length(); i++) {
                org.json.JSONObject recording = recordings.getJSONObject(i);
                if (name.equals(recording.getString("name")) && size == recording.getLong("bytes"))
                    return (float) Math.max(0, Math.min(.15, recording.optDouble("cropTop", 0)));
            }
        } catch (Exception ignored) {}
        return 0;
    }
    private void openCloud(File file) throws Exception {
        final int generation = mediaGeneration; final String requestedPath = path;
        final boolean timed = kind.equals("video") || kind.equals("audio");
        final boolean videoRequest = kind.equals("video"), requestedRemember = rememberRequestedQuality;
        final String requestedQuality = manualQuality == null ? preferredQuality() : manualQuality;
        final String previousQuality = activeQuality.isEmpty() ? "original" : activeQuality;
        manualQuality = null; rememberRequestedQuality = false;
        title.setText(new Storage(this).name(file));
        TextView loading = label("正在连接网盘…", 23); loading.setGravity(Gravity.CENTER); frame.addView(loading, new FrameLayout.LayoutParams(-1, -1));
        mediaRequests.execute(() -> {
            try {
                BaiduDrive drive = BaiduDrive.get(this);
                String resolvedQuality = requestedQuality, notice = ""; boolean remember = requestedRemember; Uri resolved;
                if (videoRequest) {
                    // A provider-required ad wait cancels this transcode attempt.
                    // Use the normal authorized original-file endpoint instead.
                    try { resolved = Uri.parse(drive.resolveVideo(requestedPath, requestedQuality)); }
                    catch (Exception unavailable) {
                        if (unavailable instanceof java.util.concurrent.CancellationException || unavailable instanceof InterruptedException) throw unavailable;
                        qualityFailure = unavailable instanceof BaiduDrive.VideoUnavailable ? ((BaiduDrive.VideoUnavailable) unavailable).code : -1;
                        if (requestedQuality.equals("original")) throw unavailable;
                        boolean adWait = qualityFailure == 133;
                        resolvedQuality = adWait ? "original" : previousQuality; remember = false;
                        try { resolved = Uri.parse(drive.resolveVideo(requestedPath, resolvedQuality)); }
                        catch (Exception previousUnavailable) {
                            if (previousUnavailable instanceof java.util.concurrent.CancellationException || previousUnavailable instanceof InterruptedException || resolvedQuality.equals("original")) throw previousUnavailable;
                            if (previousUnavailable instanceof BaiduDrive.VideoUnavailable && ((BaiduDrive.VideoUnavailable) previousUnavailable).code == 133) { adWait = true; qualityFailure = 133; }
                            resolvedQuality = "original"; resolved = Uri.parse(drive.resolveVideo(requestedPath, resolvedQuality));
                        }
                        notice = adWait ? "已自动取消转码等待，改用原画播放。" : "此清晰度暂不可用，已恢复" + BaiduStream.label(resolvedQuality) + "。";
                    }
                } else resolved = timed ? Uri.parse(drive.resolve(requestedPath)) : Uri.fromFile(drive.materialize(requestedPath));
                final Uri source = resolved; final String playingQuality = resolvedQuality, fallbackNotice = notice; final boolean saveQuality = remember;
                handler.post(() -> {
                    if (generation != mediaGeneration || isFinishing() || !requestedPath.equals(path)) return;
                    if (guard.blocked()) { stopForLimit(); return; }
                    frame.removeView(loading);
                    try {
                        if (kind.equals("video")) openVideo(file, source, playingQuality, saveQuality, fallbackNotice);
                        else if (kind.equals("audio")) openAudio(file, source);
                        else if (kind.equals("image")) openImage(new File(source.getPath()));
                        else if (kind.equals("pdf")) openPdf(new File(source.getPath()));
                        if (menu != null) { frame.removeView(menu); frame.addView(menu, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)); }
                    } catch (Exception error) { showError("网盘内容暂时无法播放，请返回重试。"); }
                });
            } catch (Exception error) { handler.post(() -> { if (generation == mediaGeneration && !isFinishing()) showError("网盘内容暂时无法播放，请检查网络后重试。"); }); }
        });
    }
    private void openAudio(File file) throws Exception { openAudio(file, Uri.fromFile(file)); }
    private void openAudio(File file, Uri source) throws Exception {
        requestAudioFocus(); LinearLayout pane = new LinearLayout(this); pane.setOrientation(LinearLayout.VERTICAL); pane.setGravity(Gravity.CENTER);
        ImageView cover = new ImageView(this); cover.setScaleType(ImageView.ScaleType.FIT_CENTER);
        try (java.io.InputStream input = getAssets().open("web/art/songs.png")) { cover.setImageBitmap(BitmapFactory.decodeStream(input)); }
        pane.addView(cover, new LinearLayout.LayoutParams(260, 260));
        frame.addView(pane, new FrameLayout.LayoutParams(-1, -1));
        audio = new MediaPlayer(); audio.setDataSource(this, source, BaiduPolicy.cloud(path) ? java.util.Collections.singletonMap("User-Agent", "pan.baidu.com") : java.util.Collections.emptyMap()); audio.setOnPreparedListener(player -> { if (player != audio) return; ready = true; int saved = savedPosition(); if (saved > 0 && saved < player.getDuration() - 500) seekTo(saved); if (guard.blocked()) { stopForLimit(); return; } if (resumed) { player.start(); checkpointPlayback(true); recordPlayed(); } else wasPlaying = true; });
        audio.setOnCompletionListener(player -> { if (player == audio) completeEpisode(); }); audio.setOnSeekCompleteListener(player -> { if (player == audio) seekComplete(); }); audio.setOnErrorListener((player, what, extra) -> { if (player == audio) showError("当前电视暂时不能播放这个音频格式。"); return true; }); audio.prepareAsync();
    }
    private void openImage(File file) {
        image = new ImageView(this); image.setScaleType(ImageView.ScaleType.FIT_CENTER); frame.addView(image, new FrameLayout.LayoutParams(-1, -1));
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeFile(file.getPath(), options);
        options.inSampleSize = 1; while (options.outWidth / options.inSampleSize > 2560 || options.outHeight / options.inSampleSize > 2160) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false; Bitmap bitmap = BitmapFactory.decodeFile(file.getPath(), options);
        if (bitmap == null) showError("这张图片暂时无法打开。"); else { image.setImageBitmap(bitmap); recordPlayed(); }
    }
    private void openPdf(File file) throws Exception {
        pdfFile = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY); pdf = new PdfRenderer(pdfFile);
        if (pdf.getPageCount() < 1) throw new Exception("这个 PDF 没有可显示的页面。");
        image = new ImageView(this); image.setScaleType(ImageView.ScaleType.FIT_CENTER); frame.addView(image, new FrameLayout.LayoutParams(-1, -1)); renderPage();
    }
    private void page(int change) { if (pdf == null) return; int next = Math.max(0, Math.min(pdf.getPageCount() - 1, pageIndex + change)); if (next != pageIndex) { pageIndex = next; renderPage(); } }
    private void renderPage() {
        try (PdfRenderer.Page page = pdf.openPage(pageIndex)) {
            float scale = Math.min(1920f / page.getWidth(), 1920f / page.getHeight());
            Bitmap bitmap = Bitmap.createBitmap(Math.max(1, Math.round(page.getWidth() * scale)), Math.max(1, Math.round(page.getHeight() * scale)), Bitmap.Config.ARGB_8888); bitmap.eraseColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); image.setImageBitmap(bitmap);
            recordPlayed();
            title.setText(getIntent().getStringExtra("title") + "  ·  " + (pageIndex + 1) + " / " + pdf.getPageCount());
        } catch (Exception e) { showError("这页绘本暂时无法打开。"); }
    }
    private void showError(String message) {
        mediaError = true; stopMedia(); frame.removeAllViews(); TextView text = label(message + "\n\n按返回键回到列表", 25); text.setGravity(Gravity.CENTER); text.setPadding(40, 30, 40, 30); frame.addView(text, new FrameLayout.LayoutParams(-1, -1));
        if (menu != null) { frame.addView(menu, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)); menu.setVisibility(View.INVISIBLE); }
        if (qualityButton != null) qualityButton.setEnabled(true);
    }
    private void renderPausedFrame() {
        if (!ready || video == null || !resumed || guard.blocked()) return;
        renderingPausedFrame = true; playbackClock.reset(android.os.SystemClock.elapsedRealtime(), video.getCurrentPosition(), false); video.setVolume(0); video.start();
        finishPausedFrame();
    }
    private void finishPausedFrame() {
        handler.removeCallbacks(finishFrame);
        if (!renderingPausedFrame || video == null || !resumed || !video.isPlaying() || seeking || firstFrameAt == 0) return;
        int position = video.getCurrentPosition();
        if (position > resumeFrameTarget + 1000 && !previewRewindAttempted) {
            previewRewindAttempted = true; seeking = true; video.seekBefore(resumeFrameTarget); return;
        }
        // Some TV HLS decoders seek to the segment start even with SEEK_CLOSEST.
        // Decode the remaining frames silently before restoring the user's state.
        if (position + 180 < resumeFrameTarget) {
            video.setPlaybackSpeed(3); handler.postDelayed(finishFrame, 40); return;
        }
        if (!video.setPlaybackSpeed(1)) { showError("播放暂时无法恢复，请返回后重试。"); return; }
        video.pause(); video.setVolume(1); renderingPausedFrame = false; wasPlaying = false;
        if (playOnPrepared && resumed) { video.start(); recordPlayed(); }
        playbackClock.reset(android.os.SystemClock.elapsedRealtime(), video.getCurrentPosition(), resumed && video.isPlaying());
        updateProgress();
    }
    private void pause() { checkpointPlayback(false); handler.removeCallbacks(finishFrame); if (video != null) { if (renderingPausedFrame) video.setPlaybackSpeed(1); if (video.isPlaying()) video.pause(); if (!renderingPausedFrame) video.setVolume(1); } if (audio != null && ready && audio.isPlaying()) audio.pause(); }
    private void toggle() { if (!ready || guard.blocked()) return; if (renderingPausedFrame && video != null) { playOnPrepared = !playOnPrepared; renderPausedFrame(); return; } checkpointPlayback(false); if (completed) { seekTo(0); completed = false; if (replayButton != null) replayButton.setVisibility(View.GONE); if (completionCard != null) { frame.removeView(completionCard); completionCard = null; } try { playback.start(seriesEntry, path, new Storage(this), true); } catch (Exception ignored) {} } if (video != null) { if (video.isPlaying()) video.pause(); else video.start(); } if (audio != null) { if (audio.isPlaying()) audio.pause(); else audio.start(); } playOnPrepared = isPlaying(); if (playOnPrepared && (video == null || firstFrameAt > 0)) recordPlayed(); checkpointPlayback(true); savePosition(); }
    private void seekTo(int position) { if (!ready || guard.blocked()) return; boolean playing = renderingPausedFrame ? playOnPrepared : isPlaying(); checkpointPlayback(false); seeking = true; if (video != null) { resumeFrameTarget = Math.max(0, Math.min(Math.max(0, video.getDuration() - 1), position)); previewRewindAttempted = false; video.seekTo(resumeFrameTarget); if (BaiduPolicy.cloud(path)) { playOnPrepared = playing; renderPausedFrame(); } } if (audio != null) audio.seekTo(Math.max(0, Math.min(Math.max(0, audio.getDuration() - 1), position))); }
    private void seek(int delta) { if (!ready) return; seekTo((video != null ? video.getCurrentPosition() : audio != null ? audio.getCurrentPosition() : 0) + delta); }
    private void stopMedia() { mediaGeneration++; checkpointPlayback(false); playbackClock.reset(0, 0, false); seeking = false; renderingPausedFrame = false; resumeFrameTarget = 0; previewRewindAttempted = false; handler.removeCallbacks(finishFrame); handler.removeCallbacks(hideMenu); if (video != null) { video.stopPlayback(); video = null; } if (audio != null) { audio.release(); audio = null; } if (audioManager != null && focusListener != null) { audioManager.abandonAudioFocus(focusListener); focusListener = null; } ready = false; }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode(); boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        // Keep the complete OK press in the layer where it began. Moving focus
        // into a newly opened ListView must never activate its current episode.
        if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (down && event.getRepeatCount() == 0 && !confirmHeld) {
                confirmHeld = true; confirmTarget = getCurrentFocus();
                confirmLayer = episodeDrawer != null ? 2 : menuVisible() ? 1 : 0;
                confirmEpisode = episodeList != null && confirmTarget == episodeList ? episodeList.getSelectedItemPosition() : -1;
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                boolean activate = confirmHeld && !event.isCanceled(); confirmHeld = false;
                int layer = episodeDrawer != null ? 2 : menuVisible() ? 1 : 0;
                if (activate && layer == confirmLayer && confirmTarget == getCurrentFocus()) {
                    if (layer == 0) {
                        if (kind.equals("video") || kind.equals("audio")) { toggle(); showProgress(); } else showMenu();
                    } else if (layer == 2 && confirmTarget == episodeList && confirmEpisode >= 0 && confirmEpisode == episodeList.getSelectedItemPosition()) {
                        if (confirmEpisode == episodeIndex) dismissMenu(); else selectEpisode(confirmEpisode);
                    } else if (confirmTarget instanceof Button) confirmTarget.performClick();
                }
            }
            return true;
        }
        if (key == KeyEvent.KEYCODE_MENU) { if (down && event.getRepeatCount() == 0) toggleMenu(); return true; }
        if (key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || key == KeyEvent.KEYCODE_MEDIA_PLAY || key == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (down && event.getRepeatCount() == 0) { boolean playing = isPlaying(); if (key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || (key == KeyEvent.KEYCODE_MEDIA_PLAY && !playing) || (key == KeyEvent.KEYCODE_MEDIA_PAUSE && playing)) toggle(); showProgress(); } return true;
        }
        if (episodeDrawer != null) {
            if (key == KeyEvent.KEYCODE_DPAD_LEFT) { if (down && event.getRepeatCount() == 0) closeEpisodes(true); return true; }
            if (key == KeyEvent.KEYCODE_DPAD_RIGHT) return true;
            return super.dispatchKeyEvent(event);
        }
        if (!menuVisible()) {
            if (key == KeyEvent.KEYCODE_DPAD_DOWN || key == KeyEvent.KEYCODE_DPAD_UP) { if (down && event.getRepeatCount() == 0) { if (key == KeyEvent.KEYCODE_DPAD_DOWN || !ready) showMenu(); else showProgress(); } return true; }
            if (key == KeyEvent.KEYCODE_DPAD_RIGHT || key == KeyEvent.KEYCODE_DPAD_LEFT) {
                if (down) { int direction = key == KeyEvent.KEYCODE_DPAD_RIGHT ? 1 : -1; if (kind.equals("pdf")) page(direction); else if (ready) { seek(direction * 10000); showProgress(); } } return true;
            }
        } else if (down) scheduleHide();
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() { if (qualityDialog != null) qualityDialog.dismiss(); else if (episodeDrawer != null) closeEpisodes(true); else if (!ready && !mediaError && BaiduPolicy.cloud(path)) finish(); else if (controlsVisible() && !mediaError) dismissMenu(); else finish(); }
    @Override protected void onResume() { super.onResume(); resumed = true; immersive(); guard.foreground(true); if (guard.blocked()) { stopForLimit(); return; } if (ready && renderingPausedFrame) renderPausedFrame(); else if (wasPlaying && ready) { if (video != null) video.start(); if (audio != null) audio.start(); checkpointPlayback(true); if (video == null || firstFrameAt > 0) recordPlayed(); } else if (ready && !playOnPrepared && firstFrameAt == 0) renderPausedFrame(); handler.post(heartbeat); }
    @Override protected void onPause() {
        confirmHeld = false;
        resumed = false; handler.removeCallbacks(heartbeat); guard.foreground(false);
        dismissMenu();
        wasPlaying = isPlaying();
        savePosition(); pause(); super.onPause();
    }
    @Override public void dump(String prefix, java.io.FileDescriptor fd, java.io.PrintWriter writer, String[] args) {
        super.dump(prefix, fd, writer, args);
        writer.println(prefix + "PIPI_PLAYER kind=" + kind + " ready=" + ready + " menu=" + menuVisible() + " hud=" + controlsVisible() + " drawer=" + (episodeDrawer != null) + " episode=" + (episodeIndex + 1) + "/" + episodes.size() + " completed=" + completed + " endCard=" + (completionCard != null) + " frame=" + frame.getWidth() + "x" + frame.getHeight() + " path=" + path
            + " quality=" + activeQuality + " qualityDialog=" + (qualityDialog != null) + " qualityFailure=" + qualityFailure + " seeking=" + seeking + " pausedPreview=" + renderingPausedFrame + " firstFrame=" + (firstFrameAt > 0)
            + (video == null || !ready ? "" : " video=" + video.decodedWidth() + "x" + video.decodedHeight() + " cropTop=" + video.cropTop() + " playing=" + video.isPlaying() + " position=" + video.getCurrentPosition() + " duration=" + video.getDuration() + " buffering=" + video.isBuffering() + " buffered=" + video.bufferPercent() + " bufferCount=" + video.bufferCount() + " bufferingMs=" + video.bufferingMs()));
        View focused = getCurrentFocus();
        writer.println(prefix + "PIPI_PLAYER_FOCUS=" + (episodeDrawer != null && focused == episodeList ? "选集 第 " + (episodeList.getSelectedItemPosition() + 1) + " 集" : focused instanceof TextView ? ((TextView) focused).getText() : focused == progress ? "播放进度" : "播放器"));
    }
    @Override protected void onDestroy() { if (qualityDialog != null) qualityDialog.dismiss(); previewGeneration++; mediaRequests.shutdownNow(); previews.shutdownNow(); handler.removeCallbacksAndMessages(null); stopMedia(); if (pdf != null) pdf.close(); if (pdfFile != null) try { pdfFile.close(); } catch (Exception ignored) {} super.onDestroy(); }
}
