package com.pipi.kids;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Read-only series discovery. No Android dependency, source-file writes or history ownership. */
final class ContentDiscovery {
    static final int MAX_ROOTS = 16, MAX_NODES = 20000, MAX_DEPTH = 12;
    static final Set<String> IGNORED = new HashSet<>(Arrays.asList("android", "lost.dir", "system volume information",
        "$recycle.bin", "recycler", "__macosx", "cache", "caches", "tmp", "temp", "thumbnails"));
    static final class Candidate {
        final String path, name, kind, sourceRoot;
        final int mediaCount;
        Candidate(File file, String kind, String root, int count) throws Exception {
            path = file.getCanonicalPath(); name = file.getName(); this.kind = kind; sourceRoot = root; mediaCount = count;
        }
    }
    static final class Result {
        final List<Candidate> entries = new ArrayList<>();
        boolean complete = true;
        int visited;
    }
    static boolean within(String path, String root) { return path.equals(root) || path.startsWith(root.equals("/") ? "/" : root + "/"); }
    static List<String> normalizeRoots(List<String> paths) throws Exception {
        List<String> all = new ArrayList<>();
        for (String path : paths) {
            if (path == null || path.trim().isEmpty() || !new File(path).isAbsolute()) throw new Exception("请选择有效的扫描文件夹。");
            String clean = new File(path).getCanonicalPath(); if (!all.contains(clean)) all.add(clean);
        }
        Collections.sort(all, (a, b) -> a.length() == b.length() ? a.compareTo(b) : a.length() - b.length());
        List<String> result = new ArrayList<>();
        for (String path : all) { boolean covered = false; for (String root : result) if (within(path, root)) { covered = true; break; } if (!covered) result.add(path); }
        if (result.size() > MAX_ROOTS) throw new Exception("最多可设置 16 个扫描路径。");
        return result;
    }
    static String kind(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (Arrays.asList("mp4", "m4v", "mkv", "mov", "webm", "avi", "ts", "m2ts", "3gp").contains(ext)) return "video";
        if (Arrays.asList("mp3", "aac", "m4a", "wav", "ogg", "flac", "opus").contains(ext)) return "audio";
        if (Arrays.asList("png", "jpg", "jpeg", "webp", "gif", "bmp").contains(ext)) return "image";
        return ext.equals("pdf") ? "pdf" : "";
    }
    static boolean eligible(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        return !name.startsWith(".") && !IGNORED.contains(name) && !new File(file, ".nomedia").isFile();
    }
    static Result scan(List<String> roots, List<String> knownSeries) throws Exception {
        Walker walker = new Walker(knownSeries);
        for (String root : normalizeRoots(roots)) {
            File file = new File(root);
            if (file.isDirectory() && file.canRead()) walker.group(file, root, true, 0);
        }
        return walker.result;
    }
    private static final class Walker {
        final Result result = new Result();
        final List<String> known;
        final Map<String, Integer> counts = new HashMap<>();
        final Set<String> counting = new HashSet<>();
        final long deadline = System.nanoTime() + 2000000000L;
        Walker(List<String> known) { this.known = known; }
        boolean budget(int depth) {
            if (depth > MAX_DEPTH || result.visited >= MAX_NODES || System.nanoTime() > deadline) { result.complete = false; return false; }
            return true;
        }
        List<File> children(File folder, String root) throws Exception {
            File[] all = folder.listFiles();
            if (all == null) { result.complete = false; return Collections.emptyList(); }
            List<File> files = new ArrayList<>();
            for (File child : all) if (eligible(child) && within(child.getCanonicalPath(), root)) files.add(child);
            Collections.sort(files, (a, b) -> naturalCompare(a.getName(), b.getName()));
            return files;
        }
        int count(File file, String root, int depth) throws Exception {
            String path = file.getCanonicalPath();
            if (counts.containsKey(path)) return counts.get(path);
            if (!budget(depth) || !eligible(file) || !within(path, root) || !counting.add(path)) return 0;
            result.visited++;
            int value = 0;
            if (file.isFile()) value = kind(file.getName()).isEmpty() ? 0 : 1;
            else if (file.isDirectory()) for (File child : children(file, root)) {
                if (!budget(depth + 1)) break;
                value += count(child, root, depth + 1);
            }
            counting.remove(path); counts.put(path, value); return value;
        }
        void group(File directory, String root, boolean top, int depth) throws Exception {
            if (!budget(depth) || !eligible(directory)) return;
            String path = directory.getCanonicalPath();
            boolean exact = known.contains(path), anchorsBelow = false;
            for (String anchor : known) if (!anchor.equals(path) && within(anchor, path)) anchorsBelow = true;
            if (exact || (!top && !anchorsBelow)) {
                int value = count(directory, root, depth);
                if (value > 0) result.entries.add(new Candidate(directory, "folder", root, value));
                return;
            }
            List<File> folders = new ArrayList<>(), files = new ArrayList<>();
            for (File child : children(directory, root)) {
                if (!budget(depth + 1)) break;
                if (child.isDirectory() && count(child, root, depth + 1) > 0) folders.add(child);
                else if (child.isFile() && !kind(child.getName()).isEmpty()) files.add(child);
            }
            // A selected folder containing only media is itself a series, not one entry per episode.
            if (!files.isEmpty() && !anchorsBelow) {
                result.entries.add(new Candidate(directory, "folder", root, count(directory, root, depth))); return;
            }
            for (File folder : folders) group(folder, root, false, depth + 1);
            for (File file : files) result.entries.add(new Candidate(file, kind(file.getName()), root, 1));
        }
    }
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
