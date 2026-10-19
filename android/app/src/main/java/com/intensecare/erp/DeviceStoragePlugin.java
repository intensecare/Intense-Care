package com.intensecare.erp;

import android.os.StatFs;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Sizes and clears the app's CACHE only. Cache files are by definition re-creatable (image cache, temporary downloads, web cache).
 * Nothing else is touched: not the login session, not app data, not the contact-sync state, not photos waiting to upload.
 */
@CapacitorPlugin(name = "DeviceStorage")
public class DeviceStoragePlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject o = new JSObject();
        long cache = size(getContext().getCacheDir()) + size(getContext().getExternalCacheDir());
        o.put("cacheBytes", cache);
        o.put("filesBytes", size(getContext().getFilesDir()) + size(getContext().getNoBackupFilesDir()));
        try {
            o.put("freeBytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes());
        } catch (Exception e) {
            o.put("freeBytes", JSObject.NULL);
        }
        call.resolve(o);
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        long before = size(getContext().getCacheDir()) + size(getContext().getExternalCacheDir());
        deleteChildren(getContext().getCacheDir());
        deleteChildren(getContext().getExternalCacheDir());
        long after = size(getContext().getCacheDir()) + size(getContext().getExternalCacheDir());
        JSObject o = new JSObject();
        o.put("freedBytes", Math.max(0, before - after));
        call.resolve(o);
    }

    private static long size(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) n += size(k);
        return n;
    }

    private static void deleteChildren(File dir) {
        if (dir == null) return;
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) deleteChildren(k);
            //noinspection ResultOfMethodCallIgnored
            k.delete();
        }
    }
}
