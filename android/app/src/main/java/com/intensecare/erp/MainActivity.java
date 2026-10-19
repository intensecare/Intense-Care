package com.intensecare.erp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before the bridge starts.
        registerPlugin(ContactSyncPlugin.class);
        registerPlugin(DeviceStoragePlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannel();
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
