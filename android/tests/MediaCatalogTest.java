package com.pipi.kids;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

public final class MediaCatalogTest {
    private static int checks;
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); checks++; }
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("pipi-catalog-");
        try {
            Path nested = Files.createDirectories(root.resolve("nested"));
            Path empty = Files.createDirectories(root.resolve("empty"));
            Path first = Files.write(root.resolve("01.mp4"), new byte[]{1});
            Files.write(nested.resolve("02.mp4"), new byte[]{2});
            int[] scans = {0}; MediaCatalog catalog = new MediaCatalog();
            MediaCatalog.Scanner scanner = () -> {
                scans[0]++; List<File> files = new ArrayList<>(), directories = new ArrayList<>();
                try (Stream<Path> paths = Files.walk(root)) {
                    paths.forEach(path -> { if (Files.isDirectory(path)) directories.add(path.toFile()); else files.add(path.toFile()); });
                }
                return new MediaCatalog.Scan(files, directories);
            };
            String key = root.toString();
            List<File> initial = catalog.get(key, 0, false, scanner);
            check(initial.size() == 2, "Initial contents are scanned");
            check(catalog.get(key, 10, false, scanner) == initial && scans[0] == 1, "Unchanged folders reuse the validated scan");
            try { initial.clear(); throw new AssertionError("Mutable cached results"); }
            catch (UnsupportedOperationException expected) { checks++; }
            Path added = Files.write(empty.resolve("new.mp4"), new byte[]{3});
            Files.setLastModifiedTime(empty, FileTime.fromMillis(empty.toFile().lastModified() + 2000));
            check(catalog.get(key, 20, false, scanner).contains(added.toFile()) && scans[0] == 2, "A new file in a previously empty nested folder invalidates the scan");
            Files.delete(first);
            Files.setLastModifiedTime(root, FileTime.fromMillis(root.toFile().lastModified() + 2000));
            check(!catalog.get(key, 30, false, scanner).contains(first.toFile()) && scans[0] == 3, "Deleted files are removed when their parent changes");
            catalog.get(key, 40, true, scanner);
            check(scans[0] == 4, "Playback planning can demand a fresh scan");
            catalog.get(key, 40 + MediaCatalog.MAX_AGE_MS, false, scanner);
            check(scans[0] == 5, "Expiry catches changes on filesystems with coarse timestamps");
            try { catalog.get(key, 20000, true, () -> { throw new java.io.IOException("Unavailable storage"); }); throw new AssertionError("Refresh should fail"); }
            catch (java.io.IOException expected) { checks++; }
            catalog.get(key, 20001, false, scanner);
            check(scans[0] == 6, "An unsuccessful refresh cannot expose the old scan");
            catalog.get("another-series", 20002, false, scanner);
            check(scans[0] == 7, "Series catalogs remain independent");
            catalog.get(key, 20003, false, scanner);
            check(scans[0] == 7, "Scanning another series preserves the first catalog");
            catalog.get(key, 1, false, scanner);
            check(scans[0] == 8, "A reset monotonic clock cannot extend cache validity");
            System.out.println("MediaCatalog: " + checks + " behavior checks passed");
        } finally {
            try (Stream<Path> paths = Files.walk(root)) {
                for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) Files.deleteIfExists(path);
            }
        }
    }
}
