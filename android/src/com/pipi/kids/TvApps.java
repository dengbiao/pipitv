package com.pipi.kids;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.text.Collator;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Parent-selected shortcuts. Media catalogs, usage, credentials and history stay independent. */
final class TvApps {
    private final Context context;
    private final PackageManager pm;
    private final SharedPreferences prefs;
    private Map<String, ResolveInfo> installed;

    TvApps(Context context) {
        this.context = context.getApplicationContext();
        pm = context.getPackageManager();
        prefs = context.getSharedPreferences("pipikids-apps", Context.MODE_PRIVATE);
    }

    synchronized void invalidate() { installed = null; }

    private boolean launchable(ActivityInfo info) {
        return info != null && info.exported && info.enabled && info.applicationInfo.enabled
            && !context.getPackageName().equals(info.packageName)
            && (info.permission == null || context.checkCallingOrSelfPermission(info.permission) == PackageManager.PERMISSION_GRANTED);
    }

    private Map<String, ResolveInfo> installed() {
        if (installed != null) return installed;
        Map<String, ResolveInfo> found = new LinkedHashMap<>();
        // Prefer the TV entrance when a package also has a phone/tablet entrance.
        for (String category : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent query = new Intent(Intent.ACTION_MAIN).addCategory(category);
            for (ResolveInfo result : pm.queryIntentActivities(query, 0)) {
                ActivityInfo info = result.activityInfo;
                if (launchable(info) && !found.containsKey(info.packageName)) found.put(info.packageName, result);
            }
        }
        installed = found;
        return found;
    }

    private LinkedHashMap<String, String> saved() throws Exception {
        return saved("selected");
    }

    private LinkedHashMap<String, String> saved(String key) throws Exception {
        JSONArray rows = new JSONArray(prefs.getString(key, "[]"));
        LinkedHashMap<String, String> selected = new LinkedHashMap<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            selected.put(row.getString("packageName"), row.optString("label", row.getString("packageName")));
        }
        return selected;
    }

    private JSONObject describe(String name, String oldLabel, boolean selected) throws Exception {
        ResolveInfo info = installed().get(name);
        String label = info == null ? oldLabel : String.valueOf(info.loadLabel(pm));
        return new JSONObject().put("packageName", name).put("label", label).put("selected", selected)
            .put("managed", managed(name))
            .put("available", info != null).put("icon", info == null ? "" : "app-icons/" + name + ".png");
    }

    synchronized JSONArray selected() throws Exception {
        JSONArray rows = new JSONArray();
        for (Map.Entry<String, String> item : saved().entrySet()) rows.put(describe(item.getKey(), item.getValue(), true));
        return rows;
    }

    synchronized JSONObject list(boolean refresh) throws Exception {
        if (refresh) invalidate();
        LinkedHashMap<String, String> selected = saved();
        LinkedHashMap<String, String> allSaved = new LinkedHashMap<>(saved("managed"));
        allSaved.putAll(selected);
        List<JSONObject> rows = new ArrayList<>();
        for (String name : installed().keySet()) rows.add(describe(name, name, selected.containsKey(name)));
        for (Map.Entry<String, String> item : allSaved.entrySet())
            if (!installed().containsKey(item.getKey())) rows.add(describe(item.getKey(), item.getValue(), selected.containsKey(item.getKey())));
        Collator order = Collator.getInstance(Locale.CHINA);
        java.util.Collections.sort(rows, (a, b) -> {
            int selection = Boolean.compare(b.optBoolean("selected"), a.optBoolean("selected"));
            if (selection != 0) return selection;
            int label = order.compare(a.optString("label"), b.optString("label"));
            return label != 0 ? label : a.optString("packageName").compareTo(b.optString("packageName"));
        });
        JSONArray result = new JSONArray(); for (JSONObject row : rows) result.put(row);
        return new JSONObject().put("supported", true).put("apps", result).put("control", AppControlService.status(context));
    }

    synchronized JSONObject setVisible(String name, boolean visible) throws Exception {
        invalidate();
        LinkedHashMap<String, String> selected = saved();
        ResolveInfo info = installed().get(name);
        if (visible) {
            if (info == null) throw new Exception("这个应用已卸载或无法打开，请刷新应用列表。");
            selected.put(name, String.valueOf(info.loadLabel(pm)));
        } else selected.remove(name);
        JSONArray rows = new JSONArray();
        for (Map.Entry<String, String> item : selected.entrySet())
            rows.put(new JSONObject().put("packageName", item.getKey()).put("label", item.getValue()));
        if (!prefs.edit().putString("selected", rows.toString()).commit()) throw new Exception("应用选择未保存，请重试。");
        return list(false);
    }

    synchronized Intent launchIntent(String name) throws Exception {
        requireSelected(name);
        invalidate();
        ResolveInfo info = installed().get(name);
        if (info == null) throw new Exception("这个应用已卸载或无法打开，请家长检查。");
        return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setComponent(new ComponentName(name, info.activityInfo.name))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
    }

    synchronized boolean managed(String name) throws Exception { return saved("managed").containsKey(name); }

    synchronized int managedCount() throws Exception { return saved("managed").size(); }

    synchronized JSONObject setManaged(String name, boolean managed) throws Exception {
        invalidate();
        LinkedHashMap<String, String> values = saved("managed");
        if (managed) {
            ResolveInfo info = installed().get(name);
            if (info == null) throw new Exception("这个应用已卸载或无法打开，请刷新应用列表。");
            values.put(name, String.valueOf(info.loadLabel(pm)));
        } else values.remove(name);
        JSONArray rows = new JSONArray();
        for (Map.Entry<String, String> item : values.entrySet())
            rows.put(new JSONObject().put("packageName", item.getKey()).put("label", item.getValue()));
        if (!prefs.edit().putString("managed", rows.toString()).commit()) throw new Exception("管控选择未保存，请重试。");
        AppControlService.configurationChanged(context);
        return list(false);
    }

    void checkLaunch(String name, Guard guard) throws Exception {
        if (!managed(name)) return;
        if (!AppControlService.ready(context)) throw new Exception("请家长先开启应用管控权限，这个应用的管控设置才会生效。");
        if (guard.blocked()) throw new Exception("现在是休息时间。");
    }

    synchronized void requireSelected(String name) throws Exception {
        if (!saved().containsKey(name)) throw new Exception("这个应用需要家长先添加到首页。");
    }

    synchronized InputStream icon(String name) throws Exception {
        ResolveInfo info = installed().get(name);
        if (info == null) throw new java.io.FileNotFoundException();
        Drawable drawable = info.loadIcon(pm);
        Bitmap bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888);
        try {
            int width = Math.max(1, drawable.getIntrinsicWidth()), height = Math.max(1, drawable.getIntrinsicHeight());
            float scale = Math.min(128f / width, 128f / height);
            int w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
            drawable.setBounds((128 - w) / 2, (128 - h) / 2, (128 + w) / 2, (128 + h) / 2);
            drawable.draw(new Canvas(bitmap));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
            return new ByteArrayInputStream(bytes.toByteArray());
        } finally { bitmap.recycle(); }
    }
}
