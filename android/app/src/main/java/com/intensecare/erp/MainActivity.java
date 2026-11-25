package com.intensecare.erp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before the bridge starts.
        registerPlugin(ContactSyncPlugin.class);
        registerPlugin(DeviceStoragePlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannel();

        /*
         * Android's WebView renderer runs in its own process and the OS can kill it at any time to
         * reclaim memory (very common on mid/low-RAM devices after the app sits in the background for
         * a while) — this is NOT the same as a crash in the app itself. Capacitor's own WebViewClient
         * reports this to WebViewListener.onRenderProcessGone() and returns false by default when no
         * listener handles it. Per Android's documented WebView contract, returning false tells the OS
         * "the app does not know how to recover," and the OS then kills the WHOLE app process — which is
         * exactly what was being seen and reported as the app "exiting unexpectedly and repeatedly."
         * Handling it here (reload the same Activity/WebView in place) keeps the app alive; the session
         * cookie survives because it lives in the WebView's persistent cookie store, not in the dead
         * renderer, so the user lands back on a signed-in screen instead of the OS home screen.
         */
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w("MainActivity", "WebView render process gone (crashed=" + detail.didCrash() + "). Restarting the activity in place instead of letting Android kill the app.");
                Intent intent = getIntent();
                finish();
                startActivity(intent);
                return true; // handled — do not let Android terminate the app process
            }
        });
    }

    /** The channel the server's push messages name ("erp_default"); Android 8+ needs it to exist before one arrives. */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel("erp_default") != null) return;
        NotificationChannel ch = new NotificationChannel("erp_default", getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(getString(R.string.notification_channel_desc));
        // Notifications show a generic title only on the lock screen.
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }
}
