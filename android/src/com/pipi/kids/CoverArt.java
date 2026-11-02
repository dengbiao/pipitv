package com.pipi.kids;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;

/** App-owned thumbnails; source files on the USB drive are only read. */
final class CoverArt {
    private final Context context;
    private final Storage storage;
    CoverArt(Context context, Storage storage) { this.context = context; this.storage = storage; }

    synchronized InputStream open(String id, Guard guard) throws Exception {
        if (!id.matches("[A-Za-z0-9-]+")) throw new FileNotFoundException();
        JSONObject entry = null; JSONArray entries = guard.entries();
        for (int i = 0; i < entries.length(); i++)
            if (id.equals(entries.getJSONObject(i).optString("id"))) entry = entries.getJSONObject(i);
        if (entry == null || !entry.optBoolean("mediaCover")) throw new FileNotFoundException();
        if (BaiduPolicy.cloud(entry.optString("path"))) return BaiduDrive.get(context).cover(entry);
        File directory = new File(context.getCacheDir(), "covers"); directory.mkdirs();
        File image = new File(directory, id + ".jpg"), stamp = new File(directory, id + ".json");
        File source = null; String last = entry.optString("lastPlayedPath", "");
        if (!last.isEmpty()) {
            File candidate = storage.parentFile(last);
            if (candidate.isFile() && storage.belongsTo(candidate, entry)) source = candidate;
        }
        if (source == null) source = storage.firstCoverFile(storage.parentFile(entry.getString("path")), 0, new int[]{600});
        if (source == null) {
            if (image.isFile()) return new FileInputStream(image);
            throw new FileNotFoundException("U 盘未连接或文件夹为空。");
        }
        String signature = "visible-frame-v2:" + source.getCanonicalPath() + ":" + source.lastModified() + ":" + source.length();
        String previous = "";
        if (stamp.isFile()) try (BufferedReader reader = new BufferedReader(new FileReader(stamp))) { previous = reader.readLine(); }
        if (!image.isFile() || !signature.equals(previous)) {
            Bitmap bitmap = frame(source);
            if (bitmap == null) {
                if (image.isFile()) return new FileInputStream(image);
                throw new IOException("这个内容暂时无法提取封面。");
            }
            File temporary = new File(directory, id + ".tmp");
            try (FileOutputStream out = new FileOutputStream(temporary)) {
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)) throw new IOException("无法生成封面。");
            } finally { bitmap.recycle(); }
            if (!temporary.renameTo(image)) throw new IOException("无法保存封面。");
            try (FileWriter writer = new FileWriter(stamp)) { writer.write(signature + "\n"); }
        }
        return new FileInputStream(image);
    }

    Bitmap frame(File file) throws Exception {
        String kind = Storage.kind(file.getName());
        if (kind.equals("image")) {
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getPath(), options); options.inSampleSize = 1;
            while (options.outWidth / options.inSampleSize > 1440 || options.outHeight / options.inSampleSize > 1440) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false; return BitmapFactory.decodeFile(file.getPath(), options);
        }
        if (kind.equals("pdf")) {
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer pdf = new PdfRenderer(fd); PdfRenderer.Page page = pdf.openPage(0)) {
                float scale = Math.min(960f / page.getWidth(), 960f / page.getHeight());
                Bitmap bitmap = Bitmap.createBitmap(Math.max(1, Math.round(page.getWidth() * scale)), Math.max(1, Math.round(page.getHeight() * scale)), Bitmap.Config.ARGB_8888);
                bitmap.eraseColor(Color.WHITE); page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); return bitmap;
            }
        }
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getCanonicalPath());
            byte[] embedded = retriever.getEmbeddedPicture();
            if (embedded != null) return BitmapFactory.decodeByteArray(embedded, 0, embedded.length);
            if (!kind.equals("video")) return null;
            long duration = 0;
            try { duration = Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)); } catch (RuntimeException ignored) {}
            long length = Math.max(0, duration * 1000L);
            long[] positions = {Math.min(10000000L, length / 4), Math.min(30000000L, length / 2),
                Math.min(60000000L, length * 3 / 4), length / 3, 0};
            Bitmap bitmap = null;
            for (long time : positions) {
                Bitmap candidate = Build.VERSION.SDK_INT >= 27
                    ? retriever.getScaledFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 960, 540)
                    : retriever.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                if (candidate == null) continue;
                if (useful(candidate)) { bitmap = candidate; break; }
                candidate.recycle();
            }
            if (bitmap != null && (bitmap.getWidth() > 1440 || bitmap.getHeight() > 1440)) {
                float scale = Math.min(1440f / bitmap.getWidth(), 1440f / bitmap.getHeight());
                Bitmap smaller = Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
                if (smaller != bitmap) bitmap.recycle(); return smaller;
            }
            return bitmap;
        } finally { retriever.release(); }
    }
    private boolean useful(Bitmap bitmap) {
        int[] pixels = new int[24 * 14]; int index = 0;
        for (int y = 0; y < 14; y++) for (int x = 0; x < 24; x++)
            pixels[index++] = bitmap.getPixel((x + 1) * bitmap.getWidth() / 25, (y + 1) * bitmap.getHeight() / 15);
        return FrameQuality.usable(pixels);
    }
}
