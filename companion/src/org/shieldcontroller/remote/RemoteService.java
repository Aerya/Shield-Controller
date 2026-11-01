package org.shieldcontroller.remote;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

public final class RemoteService extends AccessibilityService implements SharedPreferences.OnSharedPreferenceChangeListener {
    static volatile boolean connected;
    static volatile int lastKey;
    static volatile long lastAt;
    static volatile String lastError = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<Integer, GestureEngine.Binding> bindings = new HashMap<>();
    private final GestureEngine engine = new GestureEngine(new GestureEngine.Scheduler() {
        public Object later(Runnable task, long ms) { handler.postDelayed(task, ms); return task; }
        public void cancel(Object token) { handler.removeCallbacks((Runnable)token); }
    }, this::perform);
    @Override protected void onServiceConnected() {
        connected = true;
        Config.prefs(this).registerOnSharedPreferenceChangeListener(this);
        reload();
    }
    private void reload() {
        engine.clear(); bindings.clear();
        JSONArray rows = Config.read(this);
        try {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject r = rows.getJSONObject(i);
                bindings.put(r.getInt("key"), new GestureEngine.Binding(Config.action(r.opt("tap"), true),
                    Config.action(r.opt("hold"), false), Config.action(r.opt("double"), false)));
            }
        } catch (Exception e) { bindings.clear(); lastError = "Invalid saved configuration"; }
    }
    @Override public void onSharedPreferenceChanged(SharedPreferences p, String key) {
        if (key.equals("bindings")) handler.post(this::reload);
    }
    @Override protected boolean onKeyEvent(KeyEvent e) {
        if (!GestureEngine.allowed(e.getKeyCode())) return false;
        if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
            lastKey = e.getKeyCode(); lastAt = System.currentTimeMillis();
        }
        if (e.getAction() != KeyEvent.ACTION_DOWN && e.getAction() != KeyEvent.ACTION_UP) return false;
        return engine.event(e.getKeyCode(), e.getAction() == KeyEvent.ACTION_DOWN, e.getRepeatCount(), e.isCanceled(), bindings.get(e.getKeyCode()));
    }
    private void perform(String action) {
        try {
            boolean ok = true;
            switch (action) {
                case "none": break;
                case "home": ok = performGlobalAction(GLOBAL_ACTION_HOME); break;
                case "back": ok = performGlobalAction(GLOBAL_ACTION_BACK); break;
                case "recents": ok = performGlobalAction(GLOBAL_ACTION_RECENTS); break;
                case "notifications": ok = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS); break;
                default:
                    String pkg = action.substring(4);
                    Intent intent = getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
                    if (intent == null) intent = getPackageManager().getLaunchIntentForPackage(pkg);
                    if (intent == null) throw new IllegalArgumentException("Application unavailable: " + pkg);
                    startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            lastError = ok ? "" : "Android refused the action";
        } catch (Exception e) { lastError = e.getMessage() == null ? "Action failed" : e.getMessage(); }
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
    @Override public void onInterrupt() { engine.clear(); }
    @Override public void onDestroy() {
        connected = false; engine.clear(); handler.removeCallbacksAndMessages(null);
        Config.prefs(this).unregisterOnSharedPreferenceChangeListener(this); super.onDestroy();
    }
}
