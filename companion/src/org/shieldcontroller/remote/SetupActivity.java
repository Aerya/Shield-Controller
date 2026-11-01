package org.shieldcontroller.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
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
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
            catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        }); layout.addView(enable);
        Button reset = new Button(this); reset.setText(R.string.reset);
        reset.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage(R.string.reset_confirm)
            .setNegativeButton(android.R.string.cancel, null).setPositiveButton(android.R.string.ok, (d, w) -> {
                Config.prefs(this).edit().putString("bindings", "[]").apply();
                Toast.makeText(this, R.string.done, Toast.LENGTH_SHORT).show();
            }).show()); layout.addView(reset);
        setContentView(layout); enable.requestFocus();
    }
    @Override protected void onResume() { super.onResume(); status.setText(RemoteService.connected ? R.string.active : R.string.inactive); }
}
