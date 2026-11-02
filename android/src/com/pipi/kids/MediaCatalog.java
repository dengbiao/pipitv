package com.pipi.kids;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;

/** Reuse a validated series scan; nested directory changes invalidate it. */
final class MediaCatalog {
    static final long MAX_AGE_MS = 15000;
    interface Scanner { Scan scan() throws Exception; }
    static final class Scan {
        final List<File> files, directories;
        Scan(List<File> files, List<File> directories) { this.files = files; this.directories = directories; }
    }
    private static final class Entry {
        final List<File> files, directories;
        final long[] modified;
        final long loadedAt;
        Entry(Scan scan, long now) {
            files = Collections.unmodifiableList(new ArrayList<>(scan.files));
            directories = new ArrayList<>(scan.directories); modified = new long[directories.size()]; loadedAt = now;
            for (int i = 0; i < directories.size(); i++) modified[i] = directories.get(i).lastModified();
        }
        boolean current(long now) {
            if (now < loadedAt || now - loadedAt >= MAX_AGE_MS) return false;
            for (int i = 0; i < directories.size(); i++)
                if (modified[i] == 0 || directories.get(i).lastModified() != modified[i]) return false;
            return true;
        }
    }
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>();
    synchronized List<File> get(String root, long now, boolean refresh, Scanner scanner) throws Exception {
        Entry cached = entries.get(root);
        if (!refresh && cached != null && cached.current(now)) return cached.files;
        // A failed refresh must never make an older, now-unverified scan usable.
        entries.remove(root);
        Entry next = new Entry(scanner.scan(), now);
        if (entries.size() >= 32) entries.remove(entries.keySet().iterator().next());
        entries.put(root, next);
        return next.files;
    }
}
