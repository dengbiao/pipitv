package com.pipi.kids;

import android.content.Context;
import android.os.Environment;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;

final class Storage {
    private static final MediaCatalog catalog = new MediaCatalog();
    private final Context context;
    private volatile boolean catalogDirty = true;
    private long catalogAt;
    private JSONObject catalogState;
    Storage(Context context) { this.context = context; }
    File demoDir() { return new File(context.getFilesDir(), "demo"); }
    void initialize(Guard guard) throws Exception {
        String[] covers = {"animals", "colors", "songs"}, names = {"Animals", "Colors", "Songs"}, labels = {"动物世界", "色彩启蒙", "英文儿歌"};
        JSONArray entries = new JSONArray();
        for (int i = 0; i < covers.length; i++) {
            File dir = new File(demoDir(), names[i]); dir.mkdirs(); File dst = new File(dir, labels[i] + ".png");
            if (!dst.exists()) try (InputStream in = context.getAssets().open("web/art/" + covers[i] + ".png"); FileOutputStream out = new FileOutputStream(dst)) {
                byte[] buffer = new byte[32768]; int count; while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            }
            entries.put(new JSONObject().put("id", "demo-" + covers[i]).put("title", names[i]).put("subtitle", labels[i])
                .put("cover", covers[i]).put("kind", "folder").put("path", dir.getCanonicalPath()).put("demo", true));
        }
        if (!guard.hasEntriesInitialized()) guard.initEntries(entries);
        applySetup(guard);
        applyRelocations(guard);
        refreshCatalog(guard, true);
        BaiduDrive.get(context).reconcile(guard);
    }
    void invalidateCatalog() { catalogDirty = true; }
    private List<String> paths(JSONArray values) throws Exception {
        List<String> result = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) result.add(values.getString(i));
        return result;
    }
    private JSONArray pathArray(List<String> paths) { JSONArray result = new JSONArray(); for (String path : paths) result.put(path); return result; }
    private void initializeScanRoots(Guard guard) throws Exception {
        if (guard.hasScanRoots()) return;
        JSONArray devices = roots(), entries = guard.entries();
        String internal = Environment.getExternalStorageDirectory().getCanonicalPath(), demo = demoDir().getCanonicalPath();
        List<String> removable = new ArrayList<>();
        for (int i = 0; i < devices.length(); i++) {
            String path = devices.getJSONObject(i).getString("path");
            if (!ContentDiscovery.within(path, internal) && !ContentDiscovery.within(path, demo)) removable.add(path);
        }
        if (removable.isEmpty()) return;
        String selected = removable.get(0);
        for (String root : removable) for (int i = 0; i < entries.length(); i++)
            if (!entries.getJSONObject(i).optBoolean("demo") && ContentDiscovery.within(entries.getJSONObject(i).getString("path"), root)) selected = root;
        guard.initializeScanRoots(new JSONArray().put(selected));
    }
    JSONObject saveScanRoots(Guard guard, String token, JSONArray requested) throws Exception {
        guard.authorize(token);
        List<String> clean = ContentDiscovery.normalizeRoots(paths(requested)), existing = paths(guard.scanRoots());
        for (String path : clean) {
            File folder = parentFile(path);
            if (!existing.contains(path) && (!folder.isDirectory() || !folder.canRead())) throw new Exception("无法读取这个扫描路径，请确认存储已连接并已授权。");
        }
        guard.saveScanRoots(token, pathArray(clean)); invalidateCatalog(); return refreshCatalog(guard, true);
    }
    synchronized JSONObject refreshCatalog(Guard guard, boolean force) throws Exception {
        long now = android.os.SystemClock.elapsedRealtime();
        if (!force && !catalogDirty && catalogState != null && now >= catalogAt && now - catalogAt < 15000) return catalogState;
        catalogDirty = false;
        try {
            initializeScanRoots(guard);
            List<String> roots = ContentDiscovery.normalizeRoots(paths(guard.scanRoots())), known = new ArrayList<>();
            JSONArray old = guard.entries();
            for (int i = 0; i < old.length(); i++) if (!old.getJSONObject(i).optBoolean("demo") && !BaiduPolicy.cloud(old.getJSONObject(i).optString("path"))) known.add(parentFile(old.getJSONObject(i).getString("path")).getCanonicalPath());
            ContentDiscovery.Result result = ContentDiscovery.scan(roots, known);
            guard.applyCatalog(result, roots);
            JSONArray info = new JSONArray();
            for (String path : roots) { File folder = new File(path); info.put(new JSONObject().put("path", path).put("name", folder.getName()).put("available", folder.isDirectory() && folder.canRead())); }
            catalogState = new JSONObject().put("roots", info).put("scannedAt", System.currentTimeMillis()).put("complete", result.complete)
                .put("discovered", result.entries.size()).put("configured", guard.hasScanRoots());
            catalogAt = android.os.SystemClock.elapsedRealtime(); return catalogState;
        } catch (Exception error) { catalogDirty = true; throw error; }
    }
    void applyRelocations(Guard guard) throws Exception {
        InputStream input;
        try { input = context.getAssets().open("resource-relocations.json"); }
        catch (java.io.FileNotFoundException absent) { return; }
        JSONObject setup;
        try (InputStream in = input; java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            setup = new JSONObject(out.toString("UTF-8"));
        }
        if (guard.hasRelocation(setup.getString("id"))) return;
        JSONArray moves = setup.getJSONArray("moves");
        for (int i = 0; i < moves.length(); i++) {
            File target = parentFile(moves.getJSONObject(i).getString("to"));
            if (!target.exists() || !target.canRead()) return;
        }
        // Retain video resume positions; no PIN, time-limit, or source-media writes.
        android.content.SharedPreferences playback = context.getSharedPreferences("MediaActivity", Context.MODE_PRIVATE);
        android.content.SharedPreferences.Editor editor = playback.edit();
        for (int i = 0; i < moves.length(); i++) {
            JSONObject move = moves.getJSONObject(i); String from = move.getString("from"), to = move.getString("to");
            Object value = playback.getAll().get(from);
            if (value instanceof Integer) editor.putInt(to, (Integer)value).remove(from);
        }
        if (!editor.commit()) throw new java.io.IOException("无法迁移播放位置。");
        guard.relocateContent(setup);
    }
    void applySetup(Guard guard) throws Exception {
        InputStream input;
        try { input = context.getAssets().open("device-content.json"); }
        catch (java.io.FileNotFoundException absent) { return; }
        JSONObject setup;
        try (InputStream in = input; java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) > 0) out.write(buffer, 0, count);
            setup = new JSONObject(out.toString("UTF-8"));
        }
        JSONArray requested = setup.getJSONArray("entries"), clean = new JSONArray();
        for (int i = 0; i < requested.length(); i++) {
            JSONObject entry = requested.getJSONObject(i); File folder = parentFile(entry.getString("path"));
            // Defer setup until the intended drive is mounted and storage permission is granted.
            if (!folder.isDirectory() || !folder.canRead()) return;
            if (!entry.getString("id").matches("[A-Za-z0-9-]+")) throw new Exception("无效的内容入口标识。");
            clean.put(new JSONObject(entry.toString()).put("path", folder.getCanonicalPath()).put("kind", "folder").put("demo", false));
        }
        guard.applyInitialContent(setup.getString("revision"), clean);
    }
    static String kind(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT);
        if (java.util.Arrays.asList("mp4", "m4v", "mkv", "mov", "webm", "avi", "ts", "m2ts", "3gp").contains(ext)) return "video";
        if (java.util.Arrays.asList("mp3", "aac", "m4a", "wav", "ogg", "flac", "opus").contains(ext)) return "audio";
        if (java.util.Arrays.asList("png", "jpg", "jpeg", "webp", "gif", "bmp").contains(ext)) return "image";
        if (ext.equals("pdf")) return "pdf"; return "";
    }
    private static boolean within(File file, File root) throws Exception { String p = file.getCanonicalPath(), r = root.getCanonicalPath(); return p.equals(r) || p.startsWith(r + "/"); }
    boolean belongsTo(File file, JSONObject entry) throws Exception {
        if (BaiduPolicy.cloud(entry.optString("path"))) { BaiduDrive.get(context).item(file.getPath()); return BaiduPolicy.within(file.getPath(), entry.getString("path")); }
        if (BaiduPolicy.cloud(file.getPath())) return false;
        File root = parentFile(entry.getString("path"));
        return entry.optString("kind").equals("folder") ? within(file, root) : file.getCanonicalPath().equals(root.getCanonicalPath());
    }
    File firstCoverFile(File file, int depth, int[] budget) throws Exception {
        if (--budget[0] < 0 || depth > 5) return null;
        if (file.isFile()) return kind(file.getName()).isEmpty() ? null : file;
        File[] children = file.listFiles(); if (children == null) return null;
        java.util.Arrays.sort(children, (a, b) -> naturalCompare(a.getName(), b.getName()));
        for (File child : children) {
            if (!ContentDiscovery.eligible(child) || !within(child, file)) continue;
            File found = firstCoverFile(child, depth + 1, budget); if (found != null) return found;
        }
        return null;
    }
    File parentFile(String path) throws Exception {
        if (BaiduPolicy.cloud(path)) { BaiduDrive.get(context).item(path); return new File(path); }
        File file = new File(path).getCanonicalFile();
        if (within(file, context.getFilesDir()) || within(file, new File("/storage")) || within(file, new File("/sdcard"))
            || within(file, new File("/mnt/usb")) || within(file, new File("/mnt/media_rw")) || within(file, new File("/mnt/sdcard"))) return file;
        throw new Exception("请选择电视存储或 U 盘中的内容。");
    }
    File childFile(String path, Guard guard) throws Exception {
        if (BaiduPolicy.cloud(path)) { BaiduDrive.get(context).requireChild(path, guard); return new File(path); }
        File file = parentFile(path); JSONArray entries = guard.entries();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i); if (entry.optBoolean("removed") || entry.optBoolean("hidden") || !entry.optBoolean("available", true) || !guard.inScanRoots(entry.getString("path"))) continue;
            File root = new File(entry.getString("path"));
            if (entry.optString("kind").equals("folder") ? within(file, root) : file.getCanonicalPath().equals(root.getCanonicalPath())) return file;
        }
        throw new Exception("这个位置需要家长打开。");
    }
    JSONObject describe(File file) throws Exception {
        if (BaiduPolicy.cloud(file.getPath())) { JSONObject item = BaiduDrive.get(context).item(file.getPath()); item.remove("remotePath"); return item; }
        return new JSONObject().put("name", file.getName()).put("path", file.getCanonicalPath()).put("kind", file.isDirectory() ? "folder" : kind(file.getName())).put("size", file.length());
    }
    List<File> playableFiles(JSONObject entry) throws Exception {
        return playableFiles(entry, false);
    }
    List<File> playableFiles(JSONObject entry, boolean refresh) throws Exception {
        if (BaiduPolicy.cloud(entry.optString("path"))) return BaiduDrive.get(context).playable(entry);
        File root = parentFile(entry.getString("path"));
        if (!root.exists()) throw new Exception("找不到这个系列，请确认 U 盘已经接好。");
        return catalog.get(root.getPath(), android.os.SystemClock.elapsedRealtime(), refresh, () -> {
            List<File> result = new ArrayList<>(), directories = new ArrayList<>();
            collectPlayable(root, root.getPath(), result, directories, new HashSet<>(), new int[]{20000}, 0);
            if (root.isFile()) directories.add(root.getParentFile());
            Collections.sort(result, (a, b) -> naturalCompare(a.getPath(), b.getPath()));
            return new MediaCatalog.Scan(result, directories);
        });
    }
    private void collectPlayable(File file, String root, List<File> result, List<File> directories, HashSet<String> seen, int[] budget, int depth) throws Exception {
        if (--budget[0] < 0 || depth > 16 || result.size() > 2000) throw new Exception("这个系列内容较多，请将扫描路径设为更具体的内容文件夹。");
        if (!ContentDiscovery.eligible(file)) return;
        File canonical = file.getCanonicalFile(); String path = canonical.getPath();
        if (!(path.equals(root) || path.startsWith(root + "/")) || !seen.add(path)) return;
        if (canonical.isFile()) {
            String type = kind(file.getName()); if (type.equals("video") || type.equals("audio")) result.add(canonical);
            return;
        }
        File[] children = canonical.listFiles();
        if (children == null) throw new Exception("无法读取这个系列，请确认存储访问权限。");
        directories.add(canonical);
        for (File child : children) if (ContentDiscovery.eligible(child)) collectPlayable(child, root, result, directories, seen, budget, depth + 1);
    }
    JSONArray roots() throws Exception {
        JSONArray result = new JSONArray(); HashSet<String> seen = new HashSet<>();
        File internal = Environment.getExternalStorageDirectory();
        if (internal.isDirectory() && internal.canRead()) { seen.add(internal.getCanonicalPath()); result.put(describe(internal).put("name", "电视存储")); }
        File[] mounts = new File("/storage").listFiles();
        if (mounts != null) for (File file : mounts) if (file.isDirectory() && file.canRead() && !file.getName().equals("emulated") && !file.getName().equals("self") && seen.add(file.getCanonicalPath())) result.put(describe(file).put("name", "U 盘 / " + file.getName()));
        File[] externalDirs = context.getExternalFilesDirs(null);
        if (externalDirs != null) for (File file : externalDirs) if (file != null) {
            String path = file.getCanonicalPath(); int index = path.indexOf("/Android/");
            File volume = index > 0 ? new File(path.substring(0, index)) : file;
            if (volume.canRead() && seen.add(volume.getCanonicalPath())) result.put(describe(volume).put("name", "存储设备 / " + volume.getName()));
        }
        result.put(describe(demoDir()).put("name", "内置示例内容")); return result;
    }
    JSONObject list(String path, Guard guard, String token) throws Exception {
        if (BaiduPolicy.cloud(path)) return BaiduDrive.get(context).list(path, guard, token);
        File dir;
        if (!token.isEmpty()) { guard.authorize(token); dir = parentFile(path); } else dir = childFile(path, guard);
        if (!dir.exists()) throw new Exception("找不到这个位置，请确认 U 盘已经接好。");
        File[] all = dir.listFiles(); if (all == null) throw new Exception("没有读取这个文件夹的权限，请家长在存储授权中允许读取。");
        List<File> files = new ArrayList<>();
        for (File file : all) if (ContentDiscovery.eligible(file) && (file.isDirectory() || !kind(file.getName()).isEmpty())) files.add(file);
        Collections.sort(files, new Comparator<File>() { public int compare(File a, File b) {
            if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return naturalCompare(a.getName(), b.getName());
        }});
        JSONArray items = new JSONArray(); for (int i = 0; i < Math.min(files.size(), 1000); i++) items.put(describe(files.get(i)));
        return new JSONObject().put("path", dir.getCanonicalPath()).put("items", items).put("truncated", files.size() > 1000);
    }
    boolean isFile(File file) throws Exception { return BaiduPolicy.cloud(file.getPath()) ? !BaiduDrive.get(context).item(file.getPath()).getString("kind").equals("folder") : file.isFile(); }
    String name(File file) { try { return BaiduPolicy.cloud(file.getPath()) ? BaiduDrive.get(context).item(file.getPath()).getString("name") : file.getName(); } catch (Exception missing) { return file.getName(); } }
    long size(File file) { try { return BaiduPolicy.cloud(file.getPath()) ? BaiduDrive.get(context).item(file.getPath()).getLong("size") : file.length(); } catch (Exception missing) { return 0; } }
    static int naturalCompare(String a, String b) {
        int i = 0, j = 0;
        while (i < a.length() && j < b.length()) {
            char x = Character.toLowerCase(a.charAt(i)), y = Character.toLowerCase(b.charAt(j));
            if (Character.isDigit(x) && Character.isDigit(y)) {
                int ii = i, jj = j; while (ii < a.length() && Character.isDigit(a.charAt(ii))) ii++; while (jj < b.length() && Character.isDigit(b.charAt(jj))) jj++;
                String ax = a.substring(i, ii).replaceFirst("^0+(?!$)", ""), by = b.substring(j, jj).replaceFirst("^0+(?!$)", "");
                int c = ax.length() == by.length() ? ax.compareTo(by) : ax.length() - by.length(); if (c != 0) return c; i = ii; j = jj;
            } else { if (x != y) return x - y; i++; j++; }
        }
        return a.length() - b.length();
    }
}
