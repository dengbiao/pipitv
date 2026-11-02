package com.pipi.kids;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/** Separate, series-scoped storage; never writes the parent's PIN or time allowance. */
final class PlaybackStore {
    private static PlaybackStore instance;
    static synchronized PlaybackStore get(Context context) {
        if (instance == null) instance = new PlaybackStore(context.getApplicationContext());
        return instance;
    }
    private final SharedPreferences prefs, legacy, statistics, games;
    private PlaybackStore(Context context) {
        prefs = context.getSharedPreferences("pipikids-playback", Context.MODE_PRIVATE);
        legacy = context.getSharedPreferences("MediaActivity", Context.MODE_PRIVATE);
        statistics = context.getSharedPreferences("pipikids-playback-stats", Context.MODE_PRIVATE);
        games = context.getSharedPreferences("pipikids-games", Context.MODE_PRIVATE);
    }
    private static long today() { return PlaybackPlanner.localDay(System.currentTimeMillis(), TimeZone.getDefault()); }
    private PlaybackPlanner.Series read(JSONObject entry) throws Exception {
        String root = entry.getString("path");
        PlaybackPlanner.Series s = new PlaybackPlanner.Series(); s.root = root;
        JSONObject data = new JSONObject(prefs.getString(entry.getString("id"), "{}"));
        if (root.equals(data.optString("root"))) {
            s.mode = PlaybackPlanner.storedMode(data.optString("mode"), data.optInt("modeDefaultVersion"));
            s.resumePath = data.optString("resumePath"); s.lastPath = data.optString("lastPath");
            JSONArray randomPlayed = data.optJSONArray("randomPlayed");
            if (randomPlayed != null) for (int i = 0; i < randomPlayed.length(); i++) {
                String path = randomPlayed.optString(i);
                if (!path.isEmpty() && !s.randomPlayed.contains(path)) s.randomPlayed.add(path);
            }
            JSONObject items = data.optJSONObject("items");
            if (items != null) {
                java.util.Iterator<String> keys = items.keys();
                while (keys.hasNext()) {
                    String path = keys.next(); JSONObject value = items.getJSONObject(path);
                    PlaybackPlanner.Item item = s.item(path);
                    item.firstDay = value.optLong("firstDay", -1); item.lastDay = value.optLong("lastDay", -1); item.dueDay = value.optLong("dueDay", -1);
                    item.startedAt = value.optLong("startedAt"); item.stage = Math.max(0, Math.min(4, value.optInt("stage")));
                    item.completions = Math.max(0, value.optInt("completions")); item.positionMs = Math.max(0, value.optInt("positionMs"));
                    item.durationMs = Math.max(0, value.optInt("durationMs"));
                    item.gameCompletions = Math.max(0, value.optInt("gameCompletions", item.completions));
                    item.gameWatchedMs = Math.max(0, value.optLong("gameWatchedMs"));
                }
            }
        } else {
            // Import the old per-file resume once; keep existing on-TV playback progress.
            String path = entry.optString("lastPlayedPath");
            if (!path.isEmpty() && (path.equals(root) || path.startsWith(root + "/"))) {
                int position = legacy.getInt(path, 0);
                if (position > 0) { s.resumePath = path; s.item(path).positionMs = position; }
            }
        }
        return s;
    }
    private JSONObject json(PlaybackPlanner.Series s) throws Exception {
        JSONObject items = new JSONObject();
        for (java.util.Map.Entry<String, PlaybackPlanner.Item> record : s.items.entrySet()) {
            PlaybackPlanner.Item item = record.getValue();
            items.put(record.getKey(), new JSONObject().put("firstDay", item.firstDay).put("lastDay", item.lastDay).put("dueDay", item.dueDay)
                .put("startedAt", item.startedAt).put("stage", item.stage).put("completions", item.completions)
                .put("positionMs", item.positionMs).put("durationMs", item.durationMs)
                .put("gameCompletions", item.gameCompletions).put("gameWatchedMs", item.gameWatchedMs));
        }
        return new JSONObject().put("root", s.root).put("mode", s.mode).put("modeDefaultVersion", PlaybackPlanner.MODE_DEFAULT_VERSION)
            .put("resumePath", s.resumePath).put("lastPath", s.lastPath).put("randomPlayed", new JSONArray(s.randomPlayed)).put("items", items);
    }
    private void save(JSONObject entry, PlaybackPlanner.Series s) throws Exception {
        if (!prefs.edit().putString(entry.getString("id"), json(s).toString()).commit()) throw new Exception("播放进度未能保存，请重试。");
    }
    synchronized void setMode(JSONObject entry, String mode) throws Exception {
        if (!PlaybackPlanner.validMode(mode)) throw new Exception("请选择有效的播放模式。");
        PlaybackPlanner.Series s = read(entry); s.mode = mode; save(entry, s);
    }
    synchronized JSONObject plan(JSONObject entry, Storage storage, boolean restart) throws Exception {
        List<File> files = storage.playableFiles(entry, true); List<String> paths = new ArrayList<>();
        for (File file : files) paths.add(file.getPath());
        PlaybackPlanner.Series s = read(entry);
        PlaybackPlanner.Selection selection = PlaybackPlanner.select(paths, s, today(), restart);
        save(entry, s);
        JSONObject result = new JSONObject().put("path", selection.path).put("reason", selection.reason).put("mode", s.mode)
            .put("dueCount", selection.dueCount).put("newToday", selection.newToday).put("nextDay", selection.nextDay);
        if (!selection.path.isEmpty()) {
            File file = new File(selection.path); result.put("name", storage.name(file)).put("kind", Storage.kind(file.getName()));
            PlaybackPlanner.Item item = s.items.get(selection.path); result.put("positionMs", item == null ? 0 : item.positionMs);
        }
        return result;
    }
    synchronized int position(JSONObject entry, String path) throws Exception {
        PlaybackPlanner.Item item = read(entry).items.get(path); return item == null ? legacy.getInt(path, 0) : item.positionMs;
    }
    synchronized String mode(JSONObject entry) throws Exception { return read(entry).mode; }
    synchronized void start(JSONObject entry, String path, Storage storage, boolean reset) throws Exception {
        if (!storage.belongsTo(new File(path), entry)) throw new Exception("这个文件不在当前系列中。");
        PlaybackPlanner.Series s = read(entry); PlaybackPlanner.start(s, path, System.currentTimeMillis());
        if (reset) s.item(path).positionMs = 0;
        save(entry, s);
    }
    synchronized void progress(JSONObject entry, String path, int position, int duration) throws Exception {
        PlaybackPlanner.Series s = read(entry); PlaybackPlanner.progress(s, path, position, duration); save(entry, s);
    }
    synchronized void complete(JSONObject entry, String path) throws Exception {
        PlaybackPlanner.Series s = read(entry); GameProgress.complete(s.item(path)); PlaybackPlanner.complete(s, path, today()); save(entry, s);
    }
    synchronized void setGameRounds(JSONObject entry, int rounds) throws Exception {
        if (!games.edit().putInt(entry.getString("id"), GameProgress.rounds(rounds)).commit()) throw new Exception("游戏设置未能保存，请重试。");
    }
    synchronized JSONObject gameStatus(JSONObject entry, Storage storage) throws Exception {
        return gameStatus(entry, storage, true);
    }
    private JSONObject gameStatus(JSONObject entry, Storage storage, boolean refresh) throws Exception {
        int required = GameProgress.rounds(games.getInt(entry.getString("id"), GameProgress.DEFAULT_ROUNDS));
        List<String> paths = new ArrayList<>();
        try { for (File file : storage.playableFiles(entry, refresh)) paths.add(file.getPath()); }
        catch (Exception missing) { return new JSONObject().put("requiredRounds", required).put("completedRounds", 0).put("total", 0).put("readyItems", 0).put("unlocked", required == 0); }
        PlaybackPlanner.Series series = read(entry); int completed = GameProgress.completedRounds(paths, series), ready = 0;
        for (String path : paths) { PlaybackPlanner.Item item = series.items.get(path); if (required == 0 || (item != null && item.gameCompletions >= required)) ready++; }
        return new JSONObject().put("requiredRounds", required).put("completedRounds", completed).put("total", paths.size())
            .put("readyItems", ready).put("unlocked", required == 0 || (!paths.isEmpty() && completed >= required));
    }
    synchronized JSONObject gameStatuses(JSONArray entries, Storage storage) throws Exception {
        JSONObject result = new JSONObject();
        for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.getJSONObject(i); result.put(entry.getString("id"), gameStatus(entry, storage, false)); }
        return result;
    }
    synchronized void recordTime(JSONObject entry, String path, String kind, long elapsedMs) throws Exception {
        recordTime(entry, kind, elapsedMs);
        if (elapsedMs <= 0 || (!"video".equals(kind) && !"audio".equals(kind))) return;
        PlaybackPlanner.Series series = read(entry); GameProgress.record(series.item(path), elapsedMs); save(entry, series);
    }
    private JSONObject timeRecord(String id) throws Exception {
        JSONObject data = new JSONObject(statistics.getString(id, "{}"));
        return new JSONObject().put("totalMs", Math.max(0, data.optLong("totalMs")))
            .put("videoMs", Math.max(0, data.optLong("videoMs"))).put("resetAt", data.optLong("resetAt"));
    }
    synchronized void recordTime(JSONObject entry, String kind, long elapsedMs) throws Exception {
        if (elapsedMs <= 0 || (!"video".equals(kind) && !"audio".equals(kind))) return;
        String id = entry.getString("id"); JSONObject data = timeRecord(id);
        data.put("totalMs", data.getLong("totalMs") + elapsedMs);
        if ("video".equals(kind)) data.put("videoMs", data.getLong("videoMs") + elapsedMs);
        if (!statistics.edit().putString(id, data.toString()).commit()) throw new Exception("播放统计未能保存，请重试。");
    }
    synchronized void resetTime(JSONObject entry) throws Exception {
        JSONObject data = new JSONObject().put("totalMs", 0).put("videoMs", 0).put("resetAt", System.currentTimeMillis());
        if (!statistics.edit().putString(entry.getString("id"), data.toString()).commit()) throw new Exception("播放统计未能清零，请重试。");
    }
    synchronized JSONObject statistics(JSONArray entries) throws Exception {
        JSONObject series = new JSONObject(); long englishVideoMs = 0;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i), data = timeRecord(entry.getString("id"));
            series.put(entry.getString("id"), data);
            if (!"other".equals(entry.optString("language"))) englishVideoMs += data.getLong("videoMs");
        }
        return new JSONObject().put("series", series).put("englishVideoMs", englishVideoMs);
    }
    synchronized JSONObject summaries(JSONArray entries) throws Exception {
        JSONObject result = new JSONObject(); long day = today();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i); PlaybackPlanner.Series s = read(entry);
            PlaybackPlanner.Item resume = s.items.get(s.resumePath); int completed = 0, newToday = 0;
            for (PlaybackPlanner.Item item : s.items.values()) { if (item.completions > 0) completed++; if (item.firstDay == day) newToday++; }
            result.put(entry.getString("id"), new JSONObject().put("mode", s.mode).put("resumePath", s.resumePath)
                .put("resumeMs", resume == null ? 0 : resume.positionMs).put("completedCount", completed).put("newToday", newToday));
        }
        return result;
    }
    synchronized JSONObject dump(JSONArray entries) throws Exception {
        JSONObject result = new JSONObject();
        for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.getJSONObject(i); result.put(entry.getString("id"), json(read(entry))); }
        return result;
    }
}
