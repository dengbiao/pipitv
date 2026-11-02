package com.pipi.kids;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import java.io.*;
import java.lang.reflect.Field;
import java.util.*;
import org.json.*;

/** Compiled only by verify_baidu_tv.py into a disposable, separate application ID. */
public final class BaiduQaActivity extends Activity {
    final JSONArray checks = new JSONArray();
    void check(boolean result, String message) throws Exception { if (!result) throw new Exception(message); checks.put(message); }
    static void setDrive(BaiduDrive drive) throws Exception { Field field = BaiduDrive.class.getDeclaredField("instance"); field.setAccessible(true); field.set(null, drive); }
    final class Mock implements BaiduDrive.Transport {
        boolean fail, rename; String identity = "fixture-account-one", refreshError = "";
        volatile boolean holdApi, holdThumbnail;
        final java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1);
        final java.util.concurrent.CountDownLatch imageEntered = new java.util.concurrent.CountDownLatch(1), imageRelease = new java.util.concurrent.CountDownLatch(1);
        final Map<Long, JSONObject> metadata = new HashMap<>();
        boolean failStream, requireWait;
        public BaiduHttp.StreamResponse stream(String url, String userAgent) throws Exception {
            if (!userAgent.startsWith("xpanvideo;") || !userAgent.endsWith(";ts")) throw new Exception("Missing streaming identity");
            if (requireWait && !url.contains("adToken=")) return new BaiduHttp.StreamResponse(url, "{\"errno\":133,\"adTime\":1,\"adToken\":\"fixture-wait-token\"}", 200);
            return new BaiduHttp.StreamResponse(url, failStream ? "{\"errno\":31341}" : "#EXTM3U\n#EXTINF:10,\nhttps://video.baidupcs.com/fixture.ts\n#EXT-X-ENDLIST", 200);
        }
        JSONObject raw(long id, String path, boolean folder) throws Exception {
            JSONObject item = new JSONObject().put("fs_id", id).put("path", path).put("server_filename", path.substring(path.lastIndexOf('/') + 1))
                .put("isdir", folder ? 1 : 0).put("size", folder ? 0 : 1024).put("server_mtime", 12345)
                .put("thumbs", new JSONObject().put("url3", "https://thumbnail.baidupcs.com/fixture.png"));
            metadata.put(id, item); return item;
        }
        public JSONObject json(String url, JSONObject body) throws Exception {
            if (url.endsWith("/oauth/device/code")) return new JSONObject().put("device_code", "fixture-device").put("user_code", "QA-ONLY")
                .put("qrcode_url", "https://openapi.baidu.com/device/qrcode/fixture/QA-ONLY").put("expires_in", 300).put("interval", 10);
            if (url.endsWith("/oauth/token")) {
                if (body.optString("grant_type").equals("refresh_token") && !refreshError.isEmpty()) return new JSONObject().put("error", refreshError);
                return new JSONObject().put("access_token", "fixture-access-only").put("refresh_token", "fixture-refresh-only").put("expires_in", 2592000).put("scope", "basic netdisk");
            }
            if (url.contains("/passport/users/getInfo")) return new JSONObject().put("openid", identity);
            android.net.Uri uri = android.net.Uri.parse(url);
            if ("filemetas".equals(uri.getQueryParameter("method"))) {
                String value = uri.getQueryParameter("fsids"); long id = Long.parseLong(value.substring(1, value.length() - 1));
                JSONObject file = new JSONObject(metadata.get(id).toString()).put("dlink", "https://d.pcs.baidu.com/fixture?sign=fixture");
                return new JSONObject().put("errno", 0).put("list", new JSONArray().put(file));
            }
            String path = uri.getQueryParameter("dir"), start = uri.getQueryParameter("start"); JSONArray list = new JSONArray(); boolean more = false;
            if (holdApi) { holdApi = false; entered.countDown(); release.await(5, java.util.concurrent.TimeUnit.SECONDS); return new JSONObject().put("errno", 110); }
            if (path.equals("/apps/皮皮课堂")) list.put(raw(100, path + "/英语启蒙", true));
            else if (path.equals("/apps/皮皮课堂/英语启蒙")) {
                list.put(raw(200, path + "/古力小超人", true)); list.put(raw(300, path + "/WOW English", true)); list.put(raw(400, path + "/说明.txt", false));
            } else if (path.endsWith("/古力小超人")) {
                if (start.equals("0")) { list.put(raw(201, path + (rename ? "/02 Renamed.mp4" : "/02 Hello.mp4"), false)); more = true; }
                else list.put(raw(202, path + "/10 Goodbye.mp4", false));
            } else if (path.endsWith("/WOW English")) {
                if (fail) return new JSONObject().put("errno", 123);
                list.put(raw(301, path + "/第一周", true));
            } else if (path.endsWith("/第一周")) list.put(raw(302, path + "/01 Sing.mp4", false));
            else throw new Exception("Unexpected fixture directory");
            return new JSONObject().put("errno", 0).put("has_more", more).put("list", list);
        }
        public byte[] download(String url, int limit) throws Exception {
            if (holdThumbnail && url.contains("thumbnail.baidupcs.com")) { holdThumbnail = false; imageEntered.countDown(); imageRelease.await(5, java.util.concurrent.TimeUnit.SECONDS); }
            try (InputStream input = getAssets().open("web/art/logo.png")) { return BaiduHttp.read(input, limit); }
        }
    }
    void login(BaiduDrive drive, Guard guard) throws Exception {
        JSONObject flow = drive.startAuth();
        Field delay = BaiduDrive.class.getDeclaredField("pollAfter"); delay.setAccessible(true); delay.setLong(drive, 0);
        check(drive.pollAuth(flow.getString("id"), guard).getString("state").equals("connected"), "device-code exchange connects in the isolated provider fixture");
    }
    void sync(BaiduDrive drive, Guard guard) throws Exception {
        drive.startSync(new JSONObject().put("id", 100).put("path", "/apps/皮皮课堂/英语启蒙").put("name", "英语启蒙"), guard);
        long until = android.os.SystemClock.elapsedRealtime() + 10000;
        while (drive.status().getBoolean("syncing") && android.os.SystemClock.elapsedRealtime() < until) Thread.sleep(20);
        check(!drive.status().getBoolean("syncing"), "catalog sync finishes without blocking native state reads");
    }
    void verify() throws Exception {
        if (!getPackageName().equals("com.pipi.kids.baiduqa") && !getPackageName().equals("com.pipi.kids.qualityqa")) throw new Exception("QA requires an isolated package");
        getSharedPreferences("pipikids", 0).edit().clear().commit(); new BaiduCredentials(this).clear();
        File localFolder = new File(getFilesDir(), "fixture-local"); localFolder.mkdirs(); File file = new File(localFolder, "01 local.mp4");
        try (InputStream input = getAssets().open("test.mp4"); FileOutputStream output = new FileOutputStream(file)) { byte[] bytes = new byte[8192]; int n; while ((n = input.read(bytes)) > 0) output.write(bytes, 0, n); }
        Guard guard = Guard.get(this); Storage storage = new Storage(this); PlaybackStore playback = PlaybackStore.get(this);
        JSONObject local = new JSONObject().put("id", "fixture-local").put("path", localFolder.getCanonicalPath()).put("title", "本地验证视频")
            .put("kind", "folder").put("cover", "animals").put("language", "en");
        guard.initEntries(new JSONArray().put(local)); String token = guard.unlock("2468").getString("token");
        guard.saveSettings(token, new JSONObject().put("startHour", 0).put("endHour", 24).put("dailyMinutes", 180).put("sessionMinutes", 60));
        storage.saveScanRoots(guard, token, new JSONArray().put(localFolder.getCanonicalPath()));
        playback.start(local, file.getCanonicalPath(), storage, true); playback.progress(local, file.getCanonicalPath(), 1234, 65000);
        playback.resetTime(local); playback.recordTime(local, "video", 45000);
        String history = playback.dump(new JSONArray().put(local)).toString(), statistics = playback.statistics(new JSONArray().put(local)).toString();
        String pinHash = getSharedPreferences("pipikids", 0).getString("pinHash", ""), settings = guard.settings().toString();
        Mock mock = new Mock(); BaiduDrive drive = new BaiduDrive(this, mock); setDrive(drive);
        login(drive, guard); sync(drive, guard);
        check(drive.status().getString("error").isEmpty(), "complete provider traversal publishes one atomic catalog");
        check(guard.entries().length() == 3, "local content and two cloud series coexist");
        JSONObject cloud = null;
        for (int i = 0; i < guard.entries().length(); i++) { JSONObject entry = guard.entries().getJSONObject(i); if (entry.optString("title").equals("古力小超人")) cloud = entry; }
        check(cloud != null && cloud.getInt("mediaCount") == 2, "boolean has_more pagination and unsupported-file filtering preserve every video");
        String id = cloud.getString("id"), root = cloud.getString("path");
        List<File> playable = storage.playableFiles(cloud, true);
        check(playable.size() == 2 && storage.name(playable.get(0)).startsWith("02"), "natural file-name order is independent of opaque provider IDs");
        String cloudPath = playable.get(0).getPath(); playback.start(cloud, cloudPath, storage, false); playback.progress(cloud, cloudPath, 2345, 65000);
        check(drive.list(root, guard, "").getJSONArray("items").length() == 2, "child browsing stays within a published selected series");
        check(drive.resolveVideo(cloudPath, "480").contains("M3U8_AUTO_480") && drive.resolveVideo(cloudPath, "720").contains("M3U8_AUTO_720"), "lower qualities resolve actual provider HLS streams with the required identity");
        mock.failStream = true;
        try { drive.resolveVideo(cloudPath, "720"); throw new AssertionError(); } catch (Exception expected) { check(expected.getMessage().contains("转码"), "unavailable transcodes are reported instead of pretending to lower resolution"); }
        mock.failStream = false;
        mock.requireWait = true;
        long noWaitStarted = android.os.SystemClock.elapsedRealtime();
        try { drive.resolveVideo(cloudPath, "480"); throw new AssertionError(); }
        catch (BaiduDrive.VideoUnavailable requiredWait) {
            check(requiredWait.code == 133 && android.os.SystemClock.elapsedRealtime() - noWaitStarted < 800,
                "non-waiting playback rejects an ad-required transcode immediately so the player can use the authorized original file");
        }
        long waitStarted = android.os.SystemClock.elapsedRealtime(); final int[] waitNotice = {0};
        check(drive.resolveVideo(cloudPath, "480", new BaiduDrive.VideoWait() {
            public boolean active() { return true; } public boolean foreground() { return android.os.SystemClock.elapsedRealtime() - waitStarted >= 350; } public void waiting(int seconds) { waitNotice[0] = seconds; }
        }).contains("adToken=") && waitNotice[0] > 0 && android.os.SystemClock.elapsedRealtime() - waitStarted >= 1300, "provider-required ad waiting is displayed and fully elapsed in foreground before retrying");
        long reuseStarted = android.os.SystemClock.elapsedRealtime();
        check(drive.resolveVideo(cloudPath, "720").contains("adToken=") && android.os.SystemClock.elapsedRealtime() - reuseStarted < 800, "same-video quality changes reuse only a server-accepted, short-lived in-memory ticket");
        try { drive.resolveVideo(cloudPath, "480", new BaiduDrive.VideoWait() { public boolean active() { return false; } public boolean foreground() { return true; } public void waiting(int seconds) {} }); throw new AssertionError(); }
        catch (java.util.concurrent.CancellationException expected) { checks.put("cancelled playback cannot continue an ad-wait retry"); }
        mock.requireWait = false;
        try { guard.removeEntry("wrong-parent-token", id); throw new AssertionError(); } catch (Exception expected) { check(!guard.entry(id).optBoolean("removed"), "entry removal requires the authenticated parent"); }
        guard.removeEntry(token, id);
        try { guard.childEntry(id); throw new AssertionError(); } catch (Exception expected) { check(guard.entry(id).getBoolean("removed"), "deleted entries are inaccessible to child playback"); }
        sync(drive, guard);
        check(guard.entry(id).getBoolean("removed") && playback.position(guard.entry(id), cloudPath) == 2345, "resync does not resurrect a deleted entry or erase its playback history");
        guard.setEntryRemoved(token, id, false);
        check(guard.childEntry(id).getString("path").equals(root) && playback.position(guard.entry(id), cloudPath) == 2345, "restoring an entry recovers its original identity and resume position");
        try { drive.requireChild("/baidu/other-account/private/1.mp4", guard); throw new AssertionError(); } catch (Exception expected) { checks.put("a foreign account cannot resolve through the child catalog"); }
        storage.refreshCatalog(guard, true);
        check(guard.entry(id).getBoolean("available"), "USB rescanning cannot mark cloud series offline");
        guard.saveEntry(token, new JSONObject(cloud.toString()).put("title", "自定义网盘系列"), storage); guard.setEntryHidden(token, id, true);
        mock.rename = true; sync(drive, guard);
        check(guard.entry(id).getString("title").equals("自定义网盘系列") && guard.entry(id).getBoolean("hidden"), "cloud refresh retains parent titles and hidden choices");
        check(playback.position(guard.entry(id), cloudPath) == 2345 && storage.name(new File(cloudPath)).contains("Renamed"), "file rename retains fs_id identity and resume position");
        drive.startSync(new JSONObject().put("id", 200).put("path", "/apps/皮皮课堂/英语启蒙/古力小超人").put("name", "古力小超人"), guard);
        long until = android.os.SystemClock.elapsedRealtime() + 10000;
        while (drive.status().getBoolean("syncing") && android.os.SystemClock.elapsedRealtime() < until) Thread.sleep(20);
        check(guard.entry(id).getString("path").equals(root) && playback.position(guard.entry(id), cloudPath) == 2345, "narrowing the selected folder preserves the series and file identities");
        String oldId = "";
        for (int i = 0; i < guard.entries().length(); i++) if (guard.entries().getJSONObject(i).optString("title").equals("WOW English")) oldId = guard.entries().getJSONObject(i).getString("id");
        try { guard.clearStaleEntries(token, "baidu", new JSONArray().put(oldId).put(id)); throw new AssertionError(); } catch (Exception expected) { check(!guard.entry(oldId).optBoolean("removed"), "bulk cleanup validates all entries atomically and protects current content"); }
        check(guard.clearStaleEntries(token, "baidu", new JSONArray().put(oldId)) == 1, "out-of-scope cloud entries can be cleaned independently of local content");
        sync(drive, guard);
        check(guard.entry(oldId).optBoolean("removed"), "a broader sync still respects bulk removal"); guard.setEntryRemoved(token, oldId, false);
        check(guard.entry(id).getString("path").equals(root) && playback.position(guard.entry(id), cloudPath) == 2345, "expanding the selected folder preserves resume and review history");
        String before = guard.entries().toString(); long syncedAt = drive.status().getLong("lastSync"); mock.fail = true; sync(drive, guard);
        check(!drive.status().getString("error").isEmpty() && drive.status().getLong("lastSync") == syncedAt && guard.entries().toString().equals(before), "partial network failure retains the entire prior catalog and parent choices"); mock.fail = false;
        BaiduDrive restarted = new BaiduDrive(this, mock); setDrive(restarted); drive = restarted;
        check(drive.connected() && drive.status().getInt("seriesCount") == 2 && storage.playableFiles(guard.entry(id)).size() == 2, "encrypted authorization and catalog survive source recreation");
        try (InputStream input = new FileInputStream(new File(getNoBackupFilesDir(), "baidu-credentials"))) {
            String bytes = new String(BaiduHttp.read(input, 65536), "ISO-8859-1");
            check(!bytes.contains("fixture-access-only") && !bytes.contains("fixture-refresh-only"), "access and refresh tokens are not stored in plaintext");
        }
        drive.disconnect(guard); check(!drive.connected() && !guard.entry(id).getBoolean("available"), "disconnect removes credentials and suppresses cloud entries");
        login(drive, guard); sync(drive, guard);
        check(playback.position(guard.entry(id), cloudPath) == 2345 && guard.entry(id).getBoolean("hidden"), "same-account reconnection retains viewing history and visibility choices");
        mock.requireWait = true;
        try { drive.resolveVideo(cloudPath, "480"); throw new AssertionError(); } catch (BaiduDrive.VideoUnavailable expected) { check(expected.code == 133, "disconnect and reconnect cannot reuse the previous playback ticket"); }
        mock.requireWait = false;
        mock.identity = "fixture-account-two"; login(drive, guard); sync(drive, guard);
        check(!guard.entry(id).getBoolean("available"), "switching accounts cannot reveal the previous account's series");
        check(history.equals(playback.dump(new JSONArray().put(local)).toString()) && statistics.equals(playback.statistics(new JSONArray().put(local)).toString()), "cloud operations preserve local resume/review and cumulative playback totals");
        check(pinHash.equals(getSharedPreferences("pipikids", 0).getString("pinHash", "")) && settings.equals(guard.settings().toString()), "cloud operations preserve the isolated parent's PIN and time settings");
        Field authField = BaiduDrive.class.getDeclaredField("auth"); authField.setAccessible(true);
        ((JSONObject) authField.get(drive)).put("expiresAt", 0); drive.folders(BaiduPolicy.ROOT);
        check(drive.connected() && new BaiduCredentials(this).read().getLong("expiresAt") > System.currentTimeMillis(), "access-token refresh atomically saves the replacement authorization");
        ((JSONObject) authField.get(drive)).put("expiresAt", 0); mock.refreshError = "rate_limited";
        try { drive.folders(BaiduPolicy.ROOT); throw new AssertionError(); } catch (Exception expected) {}
        check(drive.connected() && new BaiduCredentials(this).read().has("refresh_token"), "a proven pre-forward rate limit preserves the refresh credential for a safe retry");
        mock.refreshError = "oauth_provider_timeout";
        try { drive.folders(BaiduPolicy.ROOT); throw new AssertionError(); } catch (Exception expected) {}
        check(!drive.connected() && !new File(getNoBackupFilesDir(), "baidu-credentials").exists(), "an ambiguous refresh result requires reauthorization rather than replaying a consumed credential");
        mock.refreshError = ""; login(drive, guard); sync(drive, guard);
        final BaiduDrive currentDrive = drive; mock.holdApi = true;
        final java.util.concurrent.atomic.AtomicBoolean staleRejected = new java.util.concurrent.atomic.AtomicBoolean();
        Thread stale = new Thread(() -> { try { currentDrive.folders(BaiduPolicy.ROOT); } catch (Exception expected) { staleRejected.set(true); } }); stale.start();
        check(mock.entered.await(3, java.util.concurrent.TimeUnit.SECONDS), "an old-account request can be held while a new authorization completes");
        drive.disconnect(guard); mock.identity = "fixture-account-three"; login(drive, guard); mock.release.countDown(); stale.join(3000);
        check(staleRejected.get() && drive.connected(), "a late old-account error cannot clear the new account's credentials");
        sync(drive, guard); String imagePath = null;
        for (int i = 0; i < guard.entries().length(); i++) { JSONObject entry = guard.entries().getJSONObject(i); if (entry.optBoolean("available") && entry.optString("source").equals("baidu")) { imagePath = storage.playableFiles(entry).get(0).getPath(); break; } }
        final String requestedImage = imagePath; mock.holdThumbnail = true;
        final java.util.concurrent.atomic.AtomicBoolean imageCancelled = new java.util.concurrent.atomic.AtomicBoolean();
        Thread picture = new Thread(() -> { try { currentDrive.thumbnail(requestedImage); } catch (Exception expected) { imageCancelled.set(true); } }); picture.start();
        check(mock.imageEntered.await(3, java.util.concurrent.TimeUnit.SECONDS), "an in-flight thumbnail is isolated from disconnect cleanup");
        drive.disconnect(guard); mock.imageRelease.countDown(); picture.join(3000);
        File[] cachedImages = new File(getCacheDir(), "baidu-thumbnails").listFiles();
        check(imageCancelled.get() && (cachedImages == null || cachedImages.length == 0), "late thumbnail responses cannot recreate cache after disconnect");
        JSONObject flow = drive.startAuth(); drive.cancelAuth(); check(drive.pollAuth(flow.getString("id"), guard).getString("state").equals("expired"), "cancelled QR flows cannot complete authorization");
        BaiduDrive live = new BaiduDrive(this, new BaiduDrive.Transport() {
            public JSONObject json(String url, JSONObject body) throws Exception { return BaiduHttp.json(url, body); }
            public byte[] download(String url, int limit) throws Exception { return BaiduHttp.download(url, limit); }
        });
        JSONObject actualQr = live.startAuth();
        try (InputStream input = live.qrImage(actualQr.getString("id"))) { check(BaiduHttp.read(input, 1024 * 1024).length > 100, "real TV TLS reaches the deployed broker and downloads an actual Baidu QR without authorizing an account"); }
        live.cancelAuth();
        guard.leaveParent();
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        new Thread(() -> {
            JSONObject result = new JSONObject();
            try { verify(); result.put("passed", true).put("count", checks.length()).put("checks", checks); }
            catch (Throwable error) { try { result.put("passed", false).put("error", error.toString()).put("checks", checks); } catch (Exception ignored) {} }
            try (FileOutputStream output = openFileOutput("baidu-qa-result.json", MODE_PRIVATE)) { output.write(result.toString().getBytes("UTF-8")); } catch (Exception ignored) {}
            android.util.Log.i("PipiBaiduQa", "Result passed=" + result.optBoolean("passed") + " checks=" + checks.length());
            runOnUiThread(() -> { startActivity(new Intent(this, MainActivity.class)); finish(); });
        }).start();
    }
}
