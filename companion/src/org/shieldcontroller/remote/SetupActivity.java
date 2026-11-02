package org.shieldcontroller.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ComponentName;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;
import android.widget.Toast;

public final class SetupActivity extends Activity {
    private TextView status;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 32, 48, 32);
        TextView title = new TextView(this); title.setText(R.string.app_name); title.setTextSize(26); layout.addView(title);
        TextView help = new TextView(this); help.setText(R.string.help); help.setTextSize(18); layout.addView(help);
        status = new TextView(this); layout.addView(status);
        Button enable = new Button(this); enable.setText(R.string.accessibility);
        enable.setOnClickListener(v -> {
            if (!open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))) {
                if (open(new Intent(Settings.ACTION_SETTINGS)))
                    Toast.makeText(this, R.string.settings_path, Toast.LENGTH_LONG).show();
                else showSettingsHelp();
            }
        }); layout.addView(enable);
        TextView fallback = new TextView(this); fallback.setText(R.string.settings_help);
        fallback.setTextSize(18); layout.addView(fallback);
        Button settings = new Button(this); settings.setText(R.string.general_settings);
        settings.setOnClickListener(v -> {
            if (!open(new Intent(Settings.ACTION_SETTINGS))) showSettingsHelp();
        }); layout.addView(settings);
        Button details = new Button(this); details.setText(R.string.app_settings);
        details.setOnClickListener(v -> {
            if (!open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())))) showSettingsHelp();
        }); layout.addView(details);
        Button reset = new Button(this); reset.setText(R.string.reset);
        reset.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage(R.string.reset_confirm)
            .setNegativeButton(android.R.string.cancel, null).setPositiveButton(android.R.string.ok, (d, w) -> {
                Config.prefs(this).edit().putString("bindings", "[]").apply();
                Toast.makeText(this, R.string.done, Toast.LENGTH_SHORT).show();
            }).show()); layout.addView(reset);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout);
        setContentView(scroll); enable.requestFocus();
    }
    private boolean open(Intent intent) {
        try {
            ComponentName target = intent.resolveActivity(getPackageManager());
            // Google TV framework stubs resolve successfully but only show an unsupported-action message.
            if (target == null || target.getPackageName().equals("com.google.android.tv.frameworkpackagestubs")) return false;
            startActivity(intent); return true;
        } catch (ActivityNotFoundException | SecurityException e) { return false; }
    }
    private void showSettingsHelp() {
        new AlertDialog.Builder(this).setTitle(R.string.settings_unavailable)
            .setMessage(R.string.settings_help).setPositiveButton(android.R.string.ok, null).show();
    }
    @Override protected void onResume() { super.onResume(); status.setText(RemoteService.connected ? R.string.active : R.string.inactive); }
}
