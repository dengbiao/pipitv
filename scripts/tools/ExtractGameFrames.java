package com.pipi.analysis;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import java.io.*;
import org.json.*;

/** Read-only ADB authoring helper; never bundled with the child application. */
public final class ExtractGameFrames {
    public static void main(String[] args) throws Exception {
        String text;
        try (InputStream in = new FileInputStream(args[0]); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            text = out.toString("UTF-8");
        }
        File directory = new File("/data/local/tmp/pipi-game-frames"); directory.mkdirs();
        JSONArray requests = new JSONArray(text), results = new JSONArray();
        MediaMetadataRetriever reader = null; String currentPath = "";
        try {
            for (int i = 0; i < requests.length(); i++) {
                JSONObject request = requests.getJSONObject(i), result = new JSONObject(request.toString());
                String path = request.getString("path"), key = request.getString("key");
                if ((!path.startsWith("/storage/4A21-0000/1. 古力小超人视频/") && !path.startsWith("/storage/4A21-0000/Wow第1季学习打卡/")) || path.contains("/../") || !key.matches("[a-z0-9-]+")) throw new Exception("Invalid source request");
                try {
                    File output = new File(directory, key + ".jpg");
                    if (!output.exists()) {
                        if (!path.equals(currentPath)) {
                            if (reader != null) reader.release();
                            reader = new MediaMetadataRetriever();
                            try (FileInputStream input = new FileInputStream(path)) { reader.setDataSource(input.getFD()); }
                            currentPath = path;
                        }
                        Bitmap frame = reader.getScaledFrameAtTime((long)(request.getDouble("seconds") * 1000000), MediaMetadataRetriever.OPTION_CLOSEST, 1280, 720);
                        if (frame == null) throw new Exception("No decoded frame");
                        result.put("width", frame.getWidth()).put("height", frame.getHeight());
                        try (FileOutputStream out = new FileOutputStream(output)) { frame.compress(Bitmap.CompressFormat.JPEG, 94, out); }
                        frame.recycle();
                    }
                    result.put("bytes", output.length());
                } catch (Exception error) { result.put("error", error.toString()); }
                results.put(result); System.out.println(result.toString()); System.out.flush();
            }
        } finally { if (reader != null) reader.release(); }
        try (FileOutputStream out = new FileOutputStream(new File(directory, "manifest.json"))) { out.write(results.toString(2).getBytes("UTF-8")); }
    }
}
