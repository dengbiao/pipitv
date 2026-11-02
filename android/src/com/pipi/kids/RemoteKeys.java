package com.pipi.kids;

import android.view.KeyEvent;
import android.webkit.WebView;
import org.json.JSONObject;

/** Own both phases of remote keys so WebView never also generates a native click. */
final class RemoteKeys {
    private RemoteKeys() {}
    static String key(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "ArrowUp";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "ArrowDown";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "ArrowLeft";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "ArrowRight";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A: return "Enter";
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_BUTTON_B: return "Escape";
            case KeyEvent.KEYCODE_MENU: return "ContextMenu";
            default: return null;
        }
    }
    static boolean dispatch(WebView web, KeyEvent event) {
        String key = key(event.getKeyCode());
        if (web == null || key == null) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN || event.getAction() == KeyEvent.ACTION_UP) {
            String phase = event.getAction() == KeyEvent.ACTION_DOWN ? "keydown" : event.isCanceled() ? "cancel" : "keyup";
            send(web, key, phase, event.getRepeatCount() > 0);
        }
        return true;
    }
    static void send(WebView web, String key, String phase, boolean repeat) {
        int code = key.equals("Enter") ? 13 : key.equals("Escape") ? 27 : key.equals("ArrowLeft") ? 37
            : key.equals("ArrowUp") ? 38 : key.equals("ArrowRight") ? 39 : key.equals("ArrowDown") ? 40 : 93;
        web.evaluateJavascript("window.__pipiRemoteKey&&window.__pipiRemoteKey(" + JSONObject.quote(key) + ","
            + JSONObject.quote(phase) + "," + repeat + "," + code + ")", null);
    }
    static void back(WebView web) {
        if (web == null) return;
        send(web, "Escape", "keydown", false);
        send(web, "Escape", "keyup", false);
    }
}
