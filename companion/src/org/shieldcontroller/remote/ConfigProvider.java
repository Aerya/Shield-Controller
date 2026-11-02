package org.shieldcontroller.remote;

import android.content.ContentProvider;
import android.content.ComponentName;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.accessibility.AccessibilityManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

/** Only the locally authorized ADB shell (or root) may read or write configuration. */
public final class ConfigProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public Bundle call(String method, String arg, Bundle extras) {
        int uid = Binder.getCallingUid();
        if (uid != 2000 && uid != 0) throw new SecurityException("ADB shell only");
        try {
            if (method.equals("set")) {
                if (arg == null || arg.length() > 24000) throw new IllegalArgumentException("Invalid configuration");
                JSONArray config = Config.validate(new String(Base64.decode(arg, Base64.NO_WRAP), StandardCharsets.UTF_8));
                if (!Config.prefs(getContext()).edit().putString("bindings", config.toString()).commit())
                    throw new IllegalStateException("Configuration could not be saved");
            } else if (!method.equals("status")) throw new IllegalArgumentException("Unknown method");
            JSONObject result = new JSONObject();
            result.put("version", 1); result.put("appVersion", 2); result.put("active", RemoteService.connected);
            AccessibilityManager manager = getContext().getSystemService(AccessibilityManager.class);
            ComponentName service = new ComponentName(getContext(), RemoteService.class);
            boolean registered = false, enabled = false;
            if (manager != null) {
                for (AccessibilityServiceInfo info : manager.getInstalledAccessibilityServiceList())
                    if (service.equals(ComponentName.unflattenFromString(info.getId()))) registered = true;
            }
            // AccessibilityManager's "enabled" list contains only bound services on Android 11.
            // Read the saved grant separately so enabled-but-disconnected remains diagnosable.
            String grants = Settings.Secure.getString(getContext().getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (grants != null) for (String component : grants.split(":"))
                if (service.equals(ComponentName.unflattenFromString(component))) enabled = true;
            result.put("registered", registered); result.put("enabled", enabled);
            result.put("bindings", Config.read(getContext()));
            result.put("lastKey", RemoteService.lastKey); result.put("lastAt", RemoteService.lastAt);
            result.put("lastError", RemoteService.lastError);
            JSONArray apps = new JSONArray(); HashSet<String> seen = new HashSet<>();
            for (String category : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
                Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(category);
                for (ResolveInfo info : getContext().getPackageManager().queryIntentActivities(intent, 0)) {
                    String pkg = info.activityInfo.packageName;
                    if (seen.add(pkg)) {
                        JSONObject app = new JSONObject(); app.put("packageName", pkg);
                        app.put("label", info.loadLabel(getContext().getPackageManager()).toString()); apps.put(app);
                    }
                }
            }
            result.put("apps", apps);
            Bundle out = new Bundle();
            out.putString("payload", Base64.encodeToString(result.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
            return out;
        } catch (Exception e) { throw new IllegalArgumentException(e.getMessage()); }
    }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String sort) { throw new SecurityException(); }
    @Override public String getType(Uri u) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { throw new SecurityException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new SecurityException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new SecurityException(); }
}
