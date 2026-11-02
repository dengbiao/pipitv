package com.pipi.kids;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.*;
import java.util.*;
import org.json.*;

/** Durable question-set sessions, independent of exposure counts and video history. */
final class GameSessions {
    private final Context context;
    private final SharedPreferences prefs;
    private final JSONObject content, deck;
    GameSessions(Context context) throws Exception {
        this.context = context; prefs = context.getSharedPreferences("pipikids-game-sessions", Context.MODE_PRIVATE);
        try (InputStream input = context.getAssets().open("web/game-content.json"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768]; int n;
            while ((n = input.read(buffer)) >= 0) { if (output.size() + n > 4 * 1024 * 1024) throw new IOException(); output.write(buffer, 0, n); }
            content = new JSONObject(output.toString("UTF-8"));
        }
        deck = content.getJSONObject("decks").optJSONObject("muzzy");
    }
    boolean matches(JSONObject entry) {
        if (deck == null || !entry.optString("source").equals("baidu")) return false;
        try {
            JSONArray sources = deck.getJSONArray("sourceVideos"); Map<String, Long> expected = new HashMap<>();
            for (int i = 0; i < sources.length(); i++) { JSONObject source = sources.getJSONObject(i); expected.put(source.getString("name"), source.getLong("bytes")); }
            BaiduDrive drive = BaiduDrive.get(context); List<File> files = drive.playable(entry);
            if (files.size() != sources.length() || sources.length() != 28) return false;
            for (File file : files) {
                JSONObject source = drive.item(file.getPath()); Long size = expected.remove(source.getString("name"));
                if (size == null || size != source.getLong("size") || !source.getString("kind").equals("video")) return false;
            }
            return expected.isEmpty();
        } catch (Exception unavailable) { return false; }
    }
    JSONArray decorate(JSONArray entries) throws Exception {
        for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.getJSONObject(i); entry.remove("gamePack"); if (matches(entry)) entry.put("gamePack", "muzzy"); }
        return entries;
    }
    private String key(JSONObject entry) throws Exception { return entry.getString("id") + ":" + BaiduDrive.digest(entry.getString("path")); }
    synchronized JSONObject read(JSONObject entry) throws Exception {
        String saved = prefs.getString(key(entry), "");
        if (!saved.isEmpty()) {
            try { JSONObject record = new JSONObject(saved); validate(record.getJSONObject("progress")); return record; }
            catch (JSONException invalid) { throw new Exception("Your saved game could not be read. Please try again."); }
        }
        return new JSONObject().put("revision", 0).put("progress", JSONObject.NULL);
    }
    synchronized JSONObject save(JSONObject entry, int expectedRevision, JSONObject progress) throws Exception {
        if (progress.toString().length() > 32768 || expectedRevision < 0 || expectedRevision == Integer.MAX_VALUE) throw new Exception("Invalid game progress.");
        validate(progress);
        JSONObject previous = read(entry);
        if (previous.getInt("revision") != expectedRevision) {
            if (previous.optJSONObject("progress") != null && previous.getJSONObject("progress").toString().equals(progress.toString())) return previous;
            throw new Exception("Your saved game changed. Please open the game again.");
        }
        transition(previous.optJSONObject("progress"), progress);
        JSONObject next = new JSONObject().put("revision", expectedRevision + 1).put("progress", new JSONObject(progress.toString()));
        if (!prefs.edit().putString(key(entry), next.toString()).commit()) throw new Exception("Your game could not be saved. Please try again.");
        return next;
    }
    private static Set<String> strings(JSONArray values) throws Exception {
        Set<String> result = new HashSet<>();
        for (int i = 0; i < values.length(); i++) { String value = values.getString(i); if (!result.add(value)) throw new Exception("Invalid game progress."); }
        return result;
    }
    void validate(JSONObject progress) throws Exception {
        if (deck == null || !progress.getString("version").equals(deck.getString("version"))) throw new Exception("This question set has changed.");
        integer(progress, "cycle", 0, Integer.MAX_VALUE);
        JSONArray sets = deck.getJSONArray("sets"); Map<String, JSONObject> known = new HashMap<>();
        for (int i = 0; i < sets.length(); i++) { JSONObject set = sets.getJSONObject(i); known.put(set.getString("id"), set); }
        Set<String> completed = strings(progress.getJSONArray("completedSets"));
        if (!known.keySet().containsAll(completed)) throw new Exception("Invalid question set.");
        JSONObject current = progress.getJSONObject("current"), set = known.get(current.getString("setId"));
        if (set == null) throw new Exception("Invalid question set.");
        JSONArray ids = current.getJSONArray("questions"); Set<String> questions = strings(ids);
        if (ids.length() != 20 || !questions.equals(strings(set.getJSONArray("questions")))) throw new Exception("Invalid question order.");
        int index = integer(current, "index", 0, ids.length());
        if (index < 0 || index > ids.length() || completed.contains(current.getString("setId")) != (index == ids.length())) throw new Exception("Invalid question position.");
        JSONObject options = current.getJSONObject("options"), all = content.getJSONObject("questions");
        if (options.length() != ids.length()) throw new Exception("Invalid picture order.");
        for (String id : questions) if (!strings(options.getJSONArray(id)).equals(strings(all.getJSONObject(id).getJSONArray("options")))) throw new Exception("Invalid picture order.");
        Set<String> misses = strings(current.getJSONArray("misses"));
        if (misses.size() > 2 || (index == ids.length() && !misses.isEmpty())) throw new Exception("Invalid picture choice.");
        if (index < ids.length()) {
            String id = ids.getString(index);
            if (!strings(options.getJSONArray(id)).containsAll(misses) || misses.contains(all.getJSONObject(id).getString("answer"))) throw new Exception("Invalid picture choice.");
        }
    }
    private static int integer(JSONObject value, String key, int min, int max) throws Exception {
        Object raw = value.get(key);
        if (!(raw instanceof Number)) throw new Exception("Invalid game progress.");
        Number number = (Number) raw; long integer = number.longValue();
        if (number.doubleValue() != integer || integer < min || integer > max) throw new Exception("Invalid game progress.");
        return (int) integer;
    }
    private void transition(JSONObject previous, JSONObject next) throws Exception {
        JSONObject round = next.getJSONObject("current"); int index = round.getInt("index");
        if (previous == null) {
            if (next.getInt("cycle") != 0 || next.getJSONArray("completedSets").length() != 0 || index != 0 || round.getJSONArray("misses").length() != 0) throw new Exception("Invalid initial game.");
            return;
        }
        JSONObject old = previous.getJSONObject("current"); int before = old.getInt("index");
        JSONArray completed = previous.getJSONArray("completedSets"), after = next.getJSONArray("completedSets");
        if (before < 20) {
            if (!round.getString("setId").equals(old.getString("setId")) || next.getInt("cycle") != previous.getInt("cycle") || !round.getJSONArray("questions").toString().equals(old.getJSONArray("questions").toString())) throw new Exception("Finish your current question set first.");
            JSONArray ids = old.getJSONArray("questions");
            for (int i = 0; i < ids.length(); i++) { String id = ids.getString(i); if (!old.getJSONObject("options").getJSONArray(id).toString().equals(round.getJSONObject("options").getJSONArray(id).toString())) throw new Exception("The picture order must stay the same."); }
            if (index == before) {
                Set<String> was = strings(old.getJSONArray("misses")), now = strings(round.getJSONArray("misses"));
                if (!after.toString().equals(completed.toString()) || !now.containsAll(was) || now.size() > was.size() + 1) throw new Exception("Invalid picture choice.");
            } else {
                JSONArray expected = new JSONArray(completed.toString()); if (index == 20) expected.put(round.getString("setId"));
                if (index != before + 1 || round.getJSONArray("misses").length() != 0 || !after.toString().equals(expected.toString())) throw new Exception("Invalid question position.");
            }
        } else {
            if (index != 0 || round.getJSONArray("misses").length() != 0) throw new Exception("Invalid new question set.");
            if (completed.length() == deck.getJSONArray("sets").length()) {
                if (next.getInt("cycle") != previous.getInt("cycle") + 1 || after.length() != 0) throw new Exception("Invalid new game cycle.");
            } else if (next.getInt("cycle") != previous.getInt("cycle") || !after.toString().equals(completed.toString()) || strings(completed).contains(round.getString("setId"))) throw new Exception("Choose an unplayed question set.");
        }
    }
}
