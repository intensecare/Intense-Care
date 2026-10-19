package com.intensecare.erp.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Per-install settings of the contact sync. The sync token is encrypted with a Keystore key; the rest (on/off,
 * paused, which ERP user it belongs to, the device id) is not secret. Stored in app-private, non-backed-up storage.
 */
public final class SyncSettings {
    private static final String PREFS = "ic_contact_sync";
    private final Context ctx;
    private final SharedPreferences prefs;
    private final SecretBox box = new AesGcmBox(new KeystoreKeyProvider());

    public SyncSettings(Context context) {
        this.ctx = context.getApplicationContext();
        this.prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public File stateDir() {
        return new File(ctx.getNoBackupFilesDir(), "contact-sync");
    }

    public FileStateStore store() {
        return new FileStateStore(stateDir(), box);
    }

    /** A random id for this install (letters, digits, - and _, 32 chars). Survives sign-out; gone on uninstall. */
    public synchronized String deviceId() {
        String id = prefs.getString("deviceId", null);
        if (id == null) {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            id = "and" + Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING).replace('=', '_').substring(0, 29);
            prefs.edit().putString("deviceId", id).apply();
        }
        return id;
    }

    public boolean enabled() { return prefs.getBoolean("enabled", false); }
    public boolean paused() { return prefs.getBoolean("paused", false); }
    public String userId() { return prefs.getString("userId", null); }
    public String baseUrl() { return prefs.getString("baseUrl", null); }
    public long enabledAt() { return prefs.getLong("enabledAt", 0); }
    public boolean askedPermission() { return prefs.getBoolean("askedPermission", false); }
    public boolean signedOut() { return prefs.getBoolean("signedOut", false); }

    public void setAskedPermission() { prefs.edit().putBoolean("askedPermission", true).apply(); }
    public void setPaused(boolean paused) { prefs.edit().putBoolean("paused", paused).apply(); }
    public void setSignedOut(boolean v) { prefs.edit().putBoolean("signedOut", v).apply(); }
    public void setUserId(String id) { prefs.edit().putString("userId", id).apply(); }

    public synchronized void enable(String baseUrl, String token, String userId) throws Exception {
        byte[] sealed = box.seal(token.getBytes(StandardCharsets.UTF_8));
        prefs.edit()
            .putString("token", Base64.encodeToString(sealed, Base64.NO_WRAP))
            .putString("baseUrl", baseUrl)
            .putString("userId", userId)
            .putBoolean("enabled", true)
            .putBoolean("paused", false)
            .putBoolean("signedOut", false)
            .putLong("enabledAt", System.currentTimeMillis())
            .apply();
    }

    /** @return the sync token, or null if there is none or it can't be decrypted. */
    public synchronized String token() {
        String s = prefs.getString("token", null);
        if (s == null) return null;
        try {
            return new String(box.open(Base64.decode(s, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    /** Disconnect: forget the token, the settings and the comparison snapshot. The device id stays. */
    public synchronized void forget() {
        prefs.edit().remove("token").remove("baseUrl").remove("userId").putBoolean("enabled", false).putBoolean("paused", false).putBoolean("signedOut", false).remove("enabledAt").apply();
        store().clear();
    }
}
