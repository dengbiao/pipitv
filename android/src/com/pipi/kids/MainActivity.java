package com.pipi.kids;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private WebView web;
    private Guard guard;
    private Storage storage;
    private CoverArt covers;
    private RestReminderAudio restReminder;
    private GameAudio gameAudio;
    private GameSessions gameSessions;
    private String gameEntryId = "";
    private TvApps tvApps;
    private final NativeTextInput textInput = new NativeTextInput();
    private volatile boolean gameActive, gamePreview;
    private boolean resumed, restDue;
    private volatile boolean externalRestDue;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService cloudWorker = Executors.newFixedThreadPool(2);
    private int permissionRequestId = -1;
    private volatile String focusedControl = "";
    private final BroadcastReceiver storageEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (storage != null) storage.invalidateCatalog();
            if (web != null && resumed) web.evaluateJavascript("window.dispatchEvent(new Event('pipi-resume'))", null);
        }
    };
    private final BroadcastReceiver packageEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (tvApps != null) tvApps.invalidate();
            if (web != null && resumed) web.evaluateJavascript("window.dispatchEvent(new Event('pipi-resume'))", null);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); immersive();
        externalRestDue = getIntent().getBooleanExtra("pipiExternalRest", false);
        guard = Guard.get(this); storage = new Storage(this); covers = new CoverArt(this, storage);
        restReminder = new RestReminderAudio(this);
        gameAudio = new GameAudio(this);
        try { gameSessions = new GameSessions(this); } catch (Exception ignored) {}
        tvApps = new TvApps(this);
        web = new WebView(this); web.setBackgroundColor(Color.rgb(205, 213, 198)); setContentView(web);
        web.setFocusable(true); web.setFocusableInTouchMode(true); web.requestFocus();
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setSupportZoom(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { if (trusted(Uri.parse(url))) view.requestFocus(); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return asset(request.getUrl()); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) { return asset(Uri.parse(url)); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !trusted(Uri.parse(url)); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !trusted(request.getUrl()); }
        });
        web.addJavascriptInterface(new Bridge(), "PipiTV");
        IntentFilter media = new IntentFilter();
        for (String action : new String[]{Intent.ACTION_MEDIA_MOUNTED, Intent.ACTION_MEDIA_UNMOUNTED, Intent.ACTION_MEDIA_EJECT, Intent.ACTION_MEDIA_REMOVED, Intent.ACTION_MEDIA_BAD_REMOVAL}) media.addAction(action);
        media.addDataScheme("file");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(storageEvents, media, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(storageEvents, media);
        IntentFilter packages = new IntentFilter();
        for (String action : new String[]{Intent.ACTION_PACKAGE_ADDED, Intent.ACTION_PACKAGE_REMOVED, Intent.ACTION_PACKAGE_CHANGED, Intent.ACTION_PACKAGE_REPLACED}) packages.addAction(action);
        packages.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packageEvents, packages, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(packageEvents, packages);
        worker.execute(() -> {
            try { storage.initialize(guard); runOnUiThread(() -> web.loadUrl("https://pipi.local/")); }
            catch (Exception e) { runOnUiThread(() -> { android.widget.TextView error = new android.widget.TextView(this); error.setText("PIPI KIDS 初始化失败，请重新打开。\n" + e.getMessage()); error.setTextSize(25); error.setPadding(50, 50, 50, 50); setContentView(error); }); }
        });
    }
    private boolean trusted(Uri uri) { return "https".equals(uri.getScheme()) && "pipi.local".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443); }
    private WebResourceResponse asset(Uri uri) {
        try {
            if (!trusted(uri)) return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            String path = uri.getPath(); if (path == null || path.equals("/")) path = "/index.html";
            if (path.contains("..") || path.contains("\\")) throw new Exception("Invalid asset path");
            if (path.startsWith("/baidu-auth/") && path.endsWith(".png"))
                return new WebResourceResponse("image/png", null, BaiduDrive.get(this).qrImage(path.substring(12, path.length() - 4)));
            if (path.startsWith("/baidu-art/") && path.endsWith(".jpg")) {
                BaiduDrive drive = BaiduDrive.get(this);
                String media = drive.artPath(path.substring(11, path.length() - 4)); drive.requireChild(media, guard);
                return new WebResourceResponse("image/jpeg", null, new java.io.FileInputStream(drive.thumbnail(media)));
            }
            if (path.startsWith("/app-icons/") && path.endsWith(".png"))
                return new WebResourceResponse("image/png", null, tvApps.icon(path.substring(11, path.length() - 4)));
            if (path.startsWith("/covers/") && path.endsWith(".jpg")) {
                String id = path.substring(8, path.length() - 4);
                return new WebResourceResponse("image/jpeg", null, covers.open(id, guard));
            }
            String type = "application/octet-stream";
            if (path.endsWith(".html")) type = "text/html"; else if (path.endsWith(".js")) type = "application/javascript";
            else if (path.endsWith(".css")) type = "text/css"; else if (path.endsWith(".png")) type = "image/png";
            else if (path.endsWith(".woff2")) type = "font/woff2"; else if (path.endsWith(".svg")) type = "image/svg+xml";
            else if (path.endsWith(".m4a")) type = "audio/mp4";
            InputStream in = getAssets().open("web" + path);
            return new WebResourceResponse(type, type.startsWith("text/") || type.contains("javascript") ? "UTF-8" : null, in);
        } catch (Exception e) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    }
    private void immersive() { getWindow().getDecorView().setSystemUiVisibility(4096 | 1024 | 512 | 256 | 4 | 2); }
    private void resolve(int id, Object result, String error) {
        String payload = result == null ? "null" : result instanceof JSONObject || result instanceof org.json.JSONArray || result instanceof Boolean || result instanceof Number ? result.toString() : JSONObject.quote(result.toString());
        String code = "window.__pipiResolve&&window.__pipiResolve(" + id + "," + payload + "," + (error == null ? "null" : JSONObject.quote(error)) + ");";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }
    private final class Bridge {
        @JavascriptInterface public void focusChanged(String label) { focusedControl = label == null ? "" : label.substring(0, Math.min(label.length(), 200)); }
        @JavascriptInterface public void request(String raw) {
            if (raw == null || raw.length() > 65536) return;
            final long requestedAt = android.os.SystemClock.elapsedRealtime();
            ExecutorService executor = worker;
            try { String method = new JSONObject(raw).optString("method"); if (method.startsWith("baidu") && !method.equals("baiduStatus") && !method.equals("baiduCancel")) executor = cloudWorker; }
            catch (Exception invalid) { return; }
            executor.execute(() -> {
                long startedAt = android.os.SystemClock.elapsedRealtime();
                int id = -1;
                try {
                    JSONObject request = new JSONObject(raw); id = request.getInt("id");
                    String method = request.getString("method"); JSONObject args = request.optJSONObject("args"); if (args == null) args = new JSONObject();
                    if (method.equals("requestStorage")) { guard.authorize(args.optString("token")); requestStorage(id); return; }
                    if (method.equals("launchTvApp")) {
                        tvApps.checkLaunch(args.getString("packageName"), guard);
                        final Intent launch = tvApps.launchIntent(args.getString("packageName"));
                        final int launchId = id;
                        runOnUiThread(() -> {
                            try {
                                if (!resumed || isFinishing()) throw new Exception("请返回首页后重新打开。");
                                tvApps.checkLaunch(launch.getComponent().getPackageName(), guard);
                                // Recheck the saved selection on the UI thread before handing off.
                                tvApps.requireSelected(launch.getComponent().getPackageName());
                                guard.learning(false);
                                startActivity(launch);
                                resolve(launchId, true, null);
                            } catch (Exception error) { tvApps.invalidate(); resolve(launchId, null, "无法打开这个应用。" + error.getMessage()); }
                        });
                        return;
                    }
                    if (method.equals("editText")) {
                        guard.authorize(args.optString("token"));
                        final int inputId = id; final String label = args.optString("label", "编辑名称");
                        final String value = args.optString("value", ""); final int limit = args.optInt("maxLength", 40);
                        runOnUiThread(() -> {
                            if (!resumed || isFinishing()) { resolve(inputId, null, "请返回应用后重新编辑。"); return; }
                            textInput.show(MainActivity.this, label, value, limit, text -> {
                                try { resolve(inputId, new JSONObject().put("cancelled", text == null).put("value", text == null ? "" : text), null); }
                                catch (Exception error) { resolve(inputId, null, "无法读取输入内容，请重试。"); }
                            });
                        });
                        return;
                    }
                    if (method.equals("speakGame")) {
                        final int speechId = id; final String clip = args.optString("id");
                        if (!gameActive || (!gamePreview && guard.blocked())) { resolve(id, "cancelled", null); return; }
                        if (!gameAudio.accepts(clip)) { resolve(id, "error", null); return; }
                        runOnUiThread(() -> {
                            if (resumed && gameActive && (gamePreview || !guard.blocked())) gameAudio.play(clip, status -> resolve(speechId, status, null));
                            else resolve(speechId, "cancelled", null);
                        });
                        return;
                    }
                    Object result = handle(method, args, requestedAt);
                    if (method.equals("planPlayback") || method.equals("list") || method.equals("play") || method.equals("getState"))
                        android.util.Log.i("PipiStartup", "bridge method=" + method + " queueMs=" + (startedAt - requestedAt) + " workMs=" + (android.os.SystemClock.elapsedRealtime() - startedAt));
                    resolve(id, result, null);
                } catch (Exception e) { if (id >= 0) resolve(id, null, e.getMessage() == null ? "暂时无法完成，请重试。" : e.getMessage()); }
            });
        }
    }
    private Object handle(String method, JSONObject args, long requestedAt) throws Exception {
        String token = args.optString("token", "");
        switch (method) {
            case "announceRest": {
                String reminderId = args.optString("id");
                runOnUiThread(() -> { if (resumed && !isFinishing() && guard.blocked()) restReminder.play(reminderId); });
                return true;
            }
            case "stopRestReminder": runOnUiThread(() -> restReminder.stop()); return true;
            case "getState": {
                JSONObject catalog = storage.refreshCatalog(guard, false); BaiduDrive.get(this).reconcile(guard); org.json.JSONArray entries = guard.entries();
                if (gameSessions != null) gameSessions.decorate(entries);
                JSONObject result = new JSONObject().put("entries", entries).put("catalog", catalog).put("playback", PlaybackStore.get(this).summaries(entries))
                .put("games", PlaybackStore.get(this).gameStatuses(entries, storage))
                .put("statistics", PlaybackStore.get(this).statistics(entries)).put("settings", guard.settings()).put("usage", guard.usage())
                .put("access", guard.access()).put("pinSet", guard.pinSet()).put("pinLength", guard.pinLength()).put("native", true)
                .put("systemTextInput", true).put("tvApps", tvApps.selected()).put("tvAppControl", AppControlService.status(this))
                .put("externalRestDue", externalRestDue).put("device", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE);
                externalRestDue = false;
                return result;
            }
            case "unlock": return guard.unlock(args.optString("pin", ""));
            case "changePin": return guard.changePin(token, args.optString("pin", ""));
            case "discardParent": guard.discardParent(token); return true;
            case "leaveParent": BaiduDrive.get(this).cancelAuth(); guard.leaveParent(); return true;
            case "baiduStatus": guard.authorize(token); return BaiduDrive.get(this).status();
            case "baiduStart": guard.authorize(token); return BaiduDrive.get(this).startAuth();
            case "baiduPoll": guard.authorize(token); return BaiduDrive.get(this).pollAuth(args.getString("id"), guard);
            case "baiduCancel": guard.authorize(token); BaiduDrive.get(this).cancelAuth(); return true;
            case "baiduFolders": guard.authorize(token); return BaiduDrive.get(this).folders(args.optString("path", BaiduPolicy.ROOT));
            case "baiduSelect": guard.authorize(token); return BaiduDrive.get(this).startSync(args.getJSONObject("folder"), guard);
            case "baiduSync": guard.authorize(token); return BaiduDrive.get(this).startSync(null, guard);
            case "baiduDisconnect": guard.authorize(token); BaiduDrive.get(this).disconnect(guard); return true;
            case "saveSettings": guard.saveSettings(token, args.getJSONObject("settings")); return true;
            case "listTvApps": guard.authorize(token); return tvApps.list(true);
            case "setTvAppVisibility": guard.authorize(token); return tvApps.setVisible(args.getString("packageName"), args.getBoolean("visible"));
            case "setTvAppManaged": guard.authorize(token); return tvApps.setManaged(args.getString("packageName"), args.getBoolean("managed"));
            case "openAppControlSettings": {
                guard.authorize(token);
                Intent intent = AppControlService.permissionIntent(this);
                if (intent.resolveActivity(getPackageManager()) == null) throw new Exception("这台电视未提供应用管控权限设置入口。");
                AppControlService.allowParentSettings(this, intent);
                runOnUiThread(() -> startActivity(intent)); return true;
            }
            case "saveEntry": return guard.saveEntry(token, args.getJSONObject("entry"), storage);
            case "saveScanRoots": return storage.saveScanRoots(guard, token, args.getJSONArray("paths"));
            case "scanContent": guard.authorize(token); return storage.refreshCatalog(guard, true);
            case "setEntryVisibility": guard.setEntryHidden(token, args.getString("id"), args.optBoolean("hidden")); return true;
            case "removeEntry": guard.removeEntry(token, args.getString("id")); return true;
            case "restoreEntry": guard.setEntryRemoved(token, args.getString("id"), false); return true;
            case "clearStaleEntries": return guard.clearStaleEntries(token, args.getString("source"), args.getJSONArray("ids"));
            case "bonus": guard.bonus(token); return true;
            case "setLearning": guard.learning(args.optBoolean("active")); return true;
            case "setGameRounds": guard.authorize(token); PlaybackStore.get(this).setGameRounds(guard.entry(args.getString("entryId")), args.optInt("rounds", GameProgress.DEFAULT_ROUNDS)); return true;
            case "startGame": {
                JSONObject entry = guard.entry(args.getString("entryId")); boolean preview = args.optBoolean("preview");
                if (preview) guard.authorize(token);
                else {
                    guard.childEntry(args.getString("entryId"));
                    if (!PlaybackStore.get(this).gameStatus(entry, storage).optBoolean("unlocked")) throw new Exception("Complete the series to unlock this game.");
                    guard.learning(true);
                }
                gameActive = true; gamePreview = preview; gameEntryId = entry.getString("id"); return true;
            }
            case "getGameProgress":
            case "saveGameProgress": {
                String entryId = args.getString("entryId");
                if (!gameActive || !entryId.equals(gameEntryId) || gameSessions == null) throw new Exception("Please open the game again.");
                JSONObject entry = guard.entry(entryId);
                if (!gameSessions.matches(entry)) throw new Exception("This series has no verified question sets.");
                if (gamePreview) return new JSONObject().put("revision", 0).put("progress", JSONObject.NULL);
                guard.childEntry(entryId);
                return method.equals("getGameProgress") ? gameSessions.read(entry) : gameSessions.save(entry, args.getInt("expectedRevision"), args.getJSONObject("progress"));
            }
            case "stopGameAudio": runOnUiThread(() -> gameAudio.stop()); return true;
            case "endGame": gameActive = false; gamePreview = false; gameEntryId = ""; runOnUiThread(() -> gameAudio.stop()); guard.learning(false); return true;
            case "getRoots": guard.authorize(token); return storage.roots();
            case "list": return storage.list(args.getString("path"), guard, token);
            case "setPlaybackMode": PlaybackStore.get(this).setMode(guard.childEntry(args.getString("entryId")), args.getString("mode")); return true;
            case "resetPlaybackTime": guard.authorize(token); PlaybackStore.get(this).resetTime(guard.entry(args.getString("entryId"))); return true;
            case "planPlayback": return PlaybackStore.get(this).plan(guard.childEntry(args.getString("entryId")), storage, args.optBoolean("restart", true));
            case "play": {
                File file = storage.childFile(args.getString("path"), guard);
                if (!storage.belongsTo(file, guard.childEntry(args.getString("entryId")))) throw new Exception("这个文件不在当前系列中。");
                if (!storage.isFile(file)) throw new Exception("找不到这个文件，请检查内容来源。");
                if (Storage.kind(file.getName()).isEmpty()) throw new Exception("暂不支持这个文件格式。");
                guard.learning(true);
                Intent intent = new Intent(this, MediaActivity.class).putExtra("path", file.getCanonicalPath()).putExtra("title", args.optString("title", file.getName()))
                    .putExtra("entryId", args.optString("entryId", "")).putExtra("startupRequestedAt", requestedAt)
                    .putExtra("startupPreparationMs", args.optLong("preparationMs"));
                runOnUiThread(() -> startActivityForResult(intent, 102)); return true;
            }
            case "openSettings": {
                guard.authorize(token); Intent intent = new Intent(Settings.ACTION_SETTINGS);
                AppControlService.allowParentSettings(this, intent);
                runOnUiThread(() -> startActivity(intent)); return true;
            }
            default: throw new Exception("不支持这个操作。");
        }
    }
    private void requestStorage(int id) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < 23) { resolve(id, true, null); return; }
            String[] permissions = Build.VERSION.SDK_INT >= 33
                ? new String[]{Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO, Manifest.permission.READ_MEDIA_IMAGES}
                : new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
            boolean ready = true; for (String permission : permissions) if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) ready = false;
            if (ready) { resolve(id, true, null); return; }
            if (permissionRequestId >= 0) { resolve(id, null, "请先处理电视上的存储授权提示。"); return; }
            permissionRequestId = id; requestPermissions(permissions, 101);
        });
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 101 && permissionRequestId >= 0) {
            boolean any = false; for (int result : results) if (result == PackageManager.PERMISSION_GRANTED) any = true;
            if (any) worker.execute(() -> { try { storage.applySetup(guard); storage.refreshCatalog(guard, true); } catch (Exception ignored) {} });
            resolve(permissionRequestId, any, any ? null : "尚未允许读取电视和 U 盘，请在系统设置里允许存储访问。"); permissionRequestId = -1;
        }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 102 && resultCode == RESULT_FIRST_USER) restDue = true;
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (intent.getBooleanExtra("pipiExternalRest", false)) {
            externalRestDue = true;
            if (web != null && resumed) web.evaluateJavascript("window.dispatchEvent(new Event('pipi-rest-due'))", null);
        }
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; immersive(); if (guard != null) guard.foreground(true);
        AppControlService.clearParentSettings(this);
        if (storage != null) storage.invalidateCatalog();
        if (storage != null) BaiduDrive.get(this).refreshIfStale(guard);
        if (tvApps != null) tvApps.invalidate();
        if (web != null) {
            web.onResume(); web.resumeTimers();
            web.evaluateJavascript("window.dispatchEvent(new Event('pipi-resume'))" + (restDue ? ";window.dispatchEvent(new Event('pipi-rest-due'))" : ""), null);
            restDue = false;
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused && web != null && !textInput.isOpen()) { immersive(); web.requestFocus(); web.evaluateJavascript("window.dispatchEvent(new Event('pipi-resume'))", null); } }
    @Override protected void onPause() { resumed = false; BaiduDrive.get(this).cancelAuth(); if (gameAudio != null) gameAudio.stop(); if (restReminder != null) restReminder.stop(); if (guard != null) guard.foreground(false); if (web != null) { web.onPause(); web.pauseTimers(); } super.onPause(); }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (textInput.isOpen()) return super.dispatchKeyEvent(event);
        if (RemoteKeys.dispatch(web, event)) return true;
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() { RemoteKeys.back(web); }
    @Override public void dump(String prefix, java.io.FileDescriptor fd, java.io.PrintWriter writer, String[] args) {
        super.dump(prefix, fd, writer, args);
        if (guard != null) try {
            // Device-side acceptance diagnostics deliberately exclude PIN hashes and auth tokens.
            writer.println(prefix + "PIPI_STATE=" + new JSONObject().put("entries", guard.entries()).put("usage", guard.usage()).put("settings", guard.settings()).put("access", guard.access()));
            writer.println(prefix + "PIPI_FOCUS=" + focusedControl);
            if (tvApps != null) writer.println(prefix + "PIPI_TV_APPS=" + tvApps.selected());
            writer.println(prefix + "PIPI_APP_CONTROL=" + AppControlService.status(this));
            writer.println(prefix + "PIPI_SCAN_ROOTS=" + guard.scanRoots());
            writer.println(prefix + "PIPI_PLAYBACK=" + PlaybackStore.get(this).dump(guard.entries()));
            writer.println(prefix + "PIPI_STATISTICS=" + PlaybackStore.get(this).statistics(guard.entries()));
            if (restReminder != null) writer.println(prefix + "PIPI_REST_AUDIO=" + restReminder.diagnostics());
            if (gameAudio != null) writer.println(prefix + "PIPI_GAME_AUDIO=" + gameAudio.diagnostics());
            writer.println(prefix + "PIPI_GAMES=" + PlaybackStore.get(this).gameStatuses(guard.entries(), storage));
        } catch (Exception ignored) {}
    }
    @Override protected void onDestroy() { try { unregisterReceiver(storageEvents); unregisterReceiver(packageEvents); } catch (IllegalArgumentException ignored) {} textInput.cancel(); if (gameAudio != null) gameAudio.stop(); if (restReminder != null) restReminder.stop(); worker.shutdown(); cloudWorker.shutdownNow(); if (web != null) { web.removeJavascriptInterface("PipiTV"); web.destroy(); web = null; } super.onDestroy(); }
}
