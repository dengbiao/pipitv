package com.pipi.kids;

import java.util.HashSet;
import java.util.Set;

/** Foreground package only: no window text, nodes, screenshots or input events. */
final class AppControlSession {
    final String ownPackage;
    final Set<String> transientPackages = new HashSet<>();
    String foreground = "";

    AppControlSession(String ownPackage) {
        this.ownPackage = ownPackage;
        transientPackages.add("com.android.systemui");
        transientPackages.add("android");
    }

    boolean observe(String packageName, String className) {
        if (packageName == null || packageName.isEmpty() || transientPackages.contains(packageName)) return false;
        if (className != null && (className.contains("Toast") || className.contains("PopupWindow"))) return false;
        foreground = packageName;
        return true;
    }

    boolean controlled(boolean configured, boolean interactive, boolean exempt) {
        return configured && interactive && !exempt && !foreground.isEmpty() && !foreground.equals(ownPackage);
    }
}
