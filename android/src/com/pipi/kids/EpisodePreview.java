package com.pipi.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONObject;

/** Small, app-owned, on-demand previews. USB sources are never changed. */
final class EpisodePreview {
    final File image;
    final int durationMs;
    EpisodePreview(File image, int durationMs) { this.image = image; this.durationMs = durationMs; }

    static EpisodePreview load(Context context, File source) throws Exception {
        if (BaiduPolicy.cloud(source.getPath())) {
            BaiduDrive drive = BaiduDrive.get(context); File image = null;
            try { image = drive.thumbnail(source.getPath()); } catch (Exception ignored) {}
            return new EpisodePreview(image, 0);
        }
        String signature = "episode-v1:" + source.getCanonicalPath() + ":" + source.length() + ":" + source.lastModified();
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(signature.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte value : digest) key.append(String.format(Locale.ROOT, "%02x", value & 255));
        File directory = new File(context.getCacheDir(), "episode-previews"); directory.mkdirs();
        File image = new File(directory, key + ".jpg"), metadata = new File(directory, key + ".json");
        if (metadata.isFile()) {
            try (java.io.FileInputStream in = new java.io.FileInputStream(metadata)) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                return new EpisodePreview(image.isFile() ? image : null, new JSONObject(out.toString("UTF-8")).optInt("durationMs"));
            } catch (Exception ignored) { /* Regenerate an interrupted cache write. */ }
        }
        int duration = 0;
        MediaMetadataRetriever reader = new MediaMetadataRetriever();
        try {
            reader.setDataSource(source.getCanonicalPath());
            try { duration = Integer.parseInt(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)); } catch (Exception ignored) {}
        } finally { reader.release(); }
        Bitmap bitmap = new CoverArt(context, new Storage(context)).frame(source);
        if (bitmap != null) {
            float scale = Math.min(1f, Math.min(480f / bitmap.getWidth(), 270f / bitmap.getHeight()));
            Bitmap small = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * scale)), Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
            if (small != bitmap) bitmap.recycle();
            File temporary = new File(directory, key + ".image.tmp");
            try (FileOutputStream out = new FileOutputStream(temporary)) {
                if (!small.compress(Bitmap.CompressFormat.JPEG, 80, out)) throw new java.io.IOException("Preview encoding failed");
            }
            finally { small.recycle(); }
            if (!temporary.renameTo(image)) throw new java.io.IOException("Preview cache unavailable");
        }
        File temporary = new File(directory, key + ".metadata.tmp");
        try (FileOutputStream out = new FileOutputStream(temporary)) {
            out.write(new JSONObject().put("durationMs", duration).toString().getBytes(StandardCharsets.UTF_8));
        }
        if (!temporary.renameTo(metadata)) throw new java.io.IOException("Preview metadata unavailable");
        return new EpisodePreview(image.isFile() ? image : null, duration);
    }

}
