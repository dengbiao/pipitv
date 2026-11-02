package com.pipi.kids;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

public final class ContentDiscoveryTest {
    static int assertions;
    static void check(boolean value, String message) { assertions++; if (!value) throw new AssertionError(message); }
    static void media(Path root, String name) throws Exception { Path file = root.resolve(name); Files.createDirectories(file.getParent()); Files.write(file, new byte[]{1}); }
    public static void main(String[] args) throws Exception {
        Path temp = Files.createTempDirectory("pipi-content-scan-").toRealPath();
        try {
            Path disk = temp.resolve("USB"), sibling = temp.resolve("USB-copy");
            media(disk, "Guli/01.mp4"); media(disk, "Guli/Season 2/02.mp4"); media(disk, "WOW/01.mp4"); media(disk, "WOW/book.pdf");
            media(disk, "Android/cache/a.mp4"); media(disk, "LOST.DIR/b.mp4"); media(disk, ".secret/a.mp4"); media(sibling, "Private/a.mp4");
            Files.createDirectories(disk.resolve("Empty"));
            List<String> normalized = ContentDiscovery.normalizeRoots(Arrays.asList(disk.resolve("Guli").toString(), disk.toString()+"/", disk.toString(), sibling.toString()));
            check(normalized.size() == 2 && normalized.contains(sibling.toString()), "Parent-child collapse must respect directory boundaries");
            ContentDiscovery.Result scan = ContentDiscovery.scan(normalized.subList(0, 1), Collections.emptyList());
            check(scan.complete, "Small scan must complete"); check(scan.entries.size() == 2, "Only content folders become entries");
            check(scan.entries.get(0).name.equals("Guli") && scan.entries.get(0).mediaCount == 2, "Nested episodes stay in their series");
            check(scan.entries.get(1).name.equals("WOW") && scan.entries.get(1).mediaCount == 2, "PDFs are valid local media");
            check(ContentDiscovery.scan(Collections.emptyList(), Collections.emptyList()).entries.isEmpty(), "No configured roots means no discovery");
            scan = ContentDiscovery.scan(Arrays.asList(disk.resolve("Guli").toString()), Collections.emptyList());
            check(scan.entries.size() == 1 && scan.entries.get(0).mediaCount == 2, "Selecting a content folder keeps its nested episodes together");
            scan = ContentDiscovery.scan(Arrays.asList(disk.resolve("WOW").toString()), Collections.emptyList());
            check(scan.entries.size() == 1 && scan.entries.get(0).path.equals(disk.resolve("WOW").toString()), "A folder of episodes is a single series");
            media(disk, "Courses/Season A/a.mp4"); media(disk, "Courses/Season B/b.mp4");
            scan = ContentDiscovery.scan(Arrays.asList(disk.toString()), Arrays.asList(disk.resolve("Courses/Season A").toString()));
            List<String> paths = scan.entries.stream().map(entry -> entry.path).collect(Collectors.toList());
            check(paths.contains(disk.resolve("Courses/Season A").toString()) && paths.contains(disk.resolve("Courses/Season B").toString()), "Adding an ancestor preserves known nested series boundaries");
            Files.createSymbolicLink(disk.resolve("Outside"), sibling);
            scan = ContentDiscovery.scan(Arrays.asList(disk.toString()), Collections.emptyList());
            check(scan.entries.stream().noneMatch(entry -> entry.path.startsWith(sibling.toString())), "Symlinks cannot leave an authorized scan root");
            media(disk, "NoMedia/a.mp4"); media(disk, "NoMedia/.nomedia");
            scan = ContentDiscovery.scan(Arrays.asList(disk.toString()), Collections.emptyList());
            check(scan.entries.stream().noneMatch(entry -> entry.path.contains("NoMedia")), ".nomedia folders are skipped");
            check(ContentDiscovery.scan(Arrays.asList(temp.resolve("Missing").toString()), Collections.emptyList()).entries.isEmpty(), "Unmounted paths are retained as configuration, not scan failures");
            check(ContentDiscovery.normalizeRoots(Arrays.asList(disk.resolve("Outside").toString(), sibling.toString())).size() == 1, "Canonical aliases are deduplicated");
            check(ContentDiscovery.kind("A.MP4").equals("video") && ContentDiscovery.kind("a.exe").isEmpty(), "Media type allowlist is case independent");
            System.out.println("ContentDiscovery: " + assertions + " behavior checks passed");
        } finally {
            try (java.util.stream.Stream<Path> tree = Files.walk(temp)) {
                for (Path file : tree.sorted(java.util.Comparator.reverseOrder()).collect(Collectors.toList())) Files.deleteIfExists(file);
            }
        }
    }
}
