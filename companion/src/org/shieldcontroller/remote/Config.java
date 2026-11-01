package org.shieldcontroller.remote;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;

final class Config {
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("remote", Context.MODE_PRIVATE); }
    static JSONArray read(Context c) {
        try { return new JSONArray(prefs(c).getString("bindings", "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }
    static String action(Object raw, boolean required) {
        if (raw == null || raw == JSONObject.NULL) {
            if (required) throw new IllegalArgumentException("A short press action is required");
            return null;
        }
        if (!(raw instanceof String)) throw new IllegalArgumentException("Invalid action");
        String s = (String) raw;
        if (s.equals("home") || s.equals("back") || s.equals("recents") || s.equals("notifications") || s.equals("none")
            || s.matches("app:[a-zA-Z][\\w]*(?:\\.[\\w]+)+")) return s;
        throw new IllegalArgumentException("Invalid action");
    }
    static JSONArray validate(String raw) throws Exception {
        if (raw.length() > 16384) throw new IllegalArgumentException("Configuration too large");
        JSONArray rows = new JSONArray(raw);
        if (rows.length() > 20) throw new IllegalArgumentException("Too many mappings");
        HashSet<Integer> seen = new HashSet<>();
        JSONArray clean = new JSONArray();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.getJSONObject(i);
            Object key = r.get("key");
            if (!(key instanceof Integer) || !GestureEngine.allowed((Integer)key) || !seen.add((Integer)key))
                throw new IllegalArgumentException("Unsupported or duplicate key");
            JSONObject c = new JSONObject();
            c.put("key", key);
            c.put("tap", action(r.opt("tap"), true));
            c.put("hold", action(r.opt("hold"), false));
            c.put("double", action(r.opt("double"), false));
            clean.put(c);
        }
        return clean;
    }
}
