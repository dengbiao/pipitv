package com.pipi.kids;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** The same reviewed, filename-and-size-scoped topics used by the web library. */
final class MediaTopics {
    private static volatile Map<String, String> topics;

    private static String key(String name, long bytes) { return name + "\n" + bytes; }

    static String summary(Context context, String name, long bytes) {
        if (topics == null) synchronized (MediaTopics.class) {
            if (topics == null) {
                Map<String, String> loaded = new HashMap<>();
                try (InputStream in = context.getAssets().open("web/media-topics.json")) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[4096]; int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    JSONArray videos = new JSONObject(out.toString("UTF-8")).getJSONArray("videos");
                    for (int i = 0; i < videos.length(); i++) {
                        JSONObject video = videos.getJSONObject(i); JSONArray tags = video.getJSONArray("tags");
                        StringBuilder text = new StringBuilder();
                        for (int j = 0; j < tags.length(); j++) {
                            if (j > 0) text.append(" · ");
                            text.append(tags.getString(j));
                        }
                        loaded.put(key(video.getString("name"), video.getLong("bytes")), text.toString());
                    }
                } catch (Exception ignored) { loaded.clear(); }
                topics = Collections.unmodifiableMap(loaded);
            }
        }
        String result = topics.get(key(name, bytes));
        return result == null ? "" : result;
    }
}
