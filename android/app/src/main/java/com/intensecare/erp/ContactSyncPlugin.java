package com.intensecare.erp;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.intensecare.erp.sync.android.AndroidContactSource;
import com.intensecare.erp.sync.HttpUploader;
import com.intensecare.erp.sync.RunSummary;
import com.intensecare.erp.sync.StateStore;
import com.intensecare.erp.sync.android.SyncRunner;
import com.intensecare.erp.sync.android.SyncScheduler;
import com.intensecare.erp.sync.android.SyncSettings;

/**
 * Bridge between the web app (src/lib/mobile/contact-sync.ts) and the native sync. All the work happens in
 * native code; this class only starts, stops and reports. Permission is requested only when the user asks to turn the sync on.
 */
@CapacitorPlugin(name = "ContactSync", permissions = {@Permission(strings = {Manifest.permission.READ_CONTACTS}, alias = "contacts")})
public class ContactSyncPlugin extends Plugin {
    private SyncSettings settings() {
        return new SyncSettings(getContext());
    }

    @Override
    public void load() {
        SyncRunner.setListener(() -> {
            try {
                notifyListeners("syncState", status());
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        SyncRunner.setListener(null);
    }

    private String permissionName() {
        PermissionState st = getPermissionState("contacts");
        if (st == PermissionState.GRANTED) return "granted";
        return st == PermissionState.DENIED ? "denied" : "prompt";
    }

    /** Android stops showing the permission dialog after two refusals: only the app settings can fix it then. */
    private boolean blocked() {
        return AndroidContactSource.hasPermission(getContext()) ? false : settings().askedPermission() && getActivity() != null && !getActivity().shouldShowRequestPermissionRationale(Manifest.permission.READ_CONTACTS);
    }

    private JSObject status() {
        SyncSettings s = settings();
        StateStore.Meta m = s.store().loadMeta();
        RunSummary r = m.lastRun;
        JSObject o = new JSObject();
        boolean granted = AndroidContactSource.hasPermission(getContext());
        o.put("supported", true);
        o.put("deviceId", s.deviceId());
        o.put("enabled", s.enabled());
        o.put("paused", s.paused());
        o.put("running", SyncRunner.isRunning());
        o.put("permission", granted ? "granted" : s.askedPermission() ? "denied" : "prompt");
        o.put("permissionBlocked", blocked());
        o.put("userId", s.userId() == null ? JSObject.NULL : s.userId());
        if (r != null) {
            JSObject lr = new JSObject();
            lr.put("at", r.at);
            lr.put("trigger", r.trigger);
            lr.put("ok", r.ok);
            lr.put("errorCode", r.errorCode == null ? JSObject.NULL : r.errorCode);
            lr.put("scanned", r.scanned);
            lr.put("added", r.added);
            lr.put("updated", r.updated);
            lr.put("removed", r.removed);
            lr.put("skipped", r.skipped);
            lr.put("duplicates", r.duplicates);
            lr.put("failed", r.failed);
            o.put("lastRun", lr);
            o.put("pendingBatches", r.pending > 0 ? (r.pending + 199) / 200 : 0);
            o.put("failedRecords", r.failed);
        } else {
            o.put("lastRun", JSObject.NULL);
            o.put("pendingBatches", 0);
            o.put("failedRecords", 0);
        }
        // A hint, not a promise: Android may run the job later (battery saver, Doze, standby).
        long base = Math.max(Math.max(m.lastSuccessAt, m.lastAttemptAt), s.enabledAt());
        o.put("nextAttemptAt", s.enabled() && !s.paused() && base > 0 ? base + SyncScheduler.PERIOD_HOURS * 3600_000L : JSObject.NULL);
        o.put("contactsOnPhone", granted ? new AndroidContactSource(getContext()).countWithPhone() : JSObject.NULL);
        return o;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        settings().setAskedPermission();
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            resolvePermission(call);
        } else {
            requestPermissionForAlias("contacts", call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        resolvePermission(call);
        // A run that stopped for lack of permission can carry on now.
        SyncScheduler.catchUpIfStale(getContext());
    }

    private void resolvePermission(PluginCall call) {
        JSObject o = new JSObject();
        o.put("permission", permissionName());
        o.put("blocked", blocked());
        call.resolve(o);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void enable(PluginCall call) {
        String baseUrl = call.getString("baseUrl");
        String token = call.getString("token");
        String userId = call.getString("userId");
        if (baseUrl == null || token == null || userId == null) {
            call.reject("baseUrl, token and userId are required");
            return;
        }
        boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!HttpUploader.urlAllowed(baseUrl, debug)) {
            call.reject("The ERP address must be https.");
            return;
        }
        try {
            settings().enable(baseUrl, token, userId);
            SyncScheduler.schedulePeriodic(getContext());
            call.resolve(status());
        } catch (Exception e) {
            call.reject("Could not store the connection securely on this phone.");
        }
    }

    @PluginMethod
    public void syncNow(PluginCall call) {
        String trigger = call.getString("trigger", "MANUAL");
        // While the app is open the sync runs right away; WorkManager covers the times it is closed.
        boolean started = SyncRunner.runAsync(getContext(), trigger);
        JSObject o = new JSObject();
        o.put("started", started);
        call.resolve(o);
    }

    @PluginMethod
    public void retryFailed(PluginCall call) {
        boolean started = SyncRunner.runAsync(getContext(), "RETRY");
        JSObject o = new JSObject();
        o.put("started", started);
        call.resolve(o);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        settings().setPaused(true);
        SyncScheduler.cancelAll(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        SyncSettings s = settings();
        s.setPaused(false);
        if (s.enabled()) {
            SyncScheduler.schedulePeriodic(getContext());
            SyncRunner.runAsync(getContext(), "MANUAL");
        }
        call.resolve(status());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        SyncScheduler.cancelAll(getContext());
        settings().forget();
        call.resolve(status());
    }

    @PluginMethod
    public void signedOut(PluginCall call) {
        // Stop the schedule, keep the connection: signing back in as the same user carries on.
        SyncScheduler.cancelAll(getContext());
        settings().setSignedOut(true);
        call.resolve();
    }

    @PluginMethod
    public void signedIn(final PluginCall call) {
        final String userId = call.getString("userId");
        final SyncSettings s = settings();
        final JSObject o = new JSObject();
        if (s.enabled() && s.userId() != null && userId != null && !s.userId().equals(userId)) {
            // A different person is using this phone: this phone's contacts must not flow into their account
            // (or the other way round). Disconnect the previous link; the new user can connect their own.
            final String token = s.token();
            final String base = s.baseUrl();
            final String deviceId = s.deviceId();
            final boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            SyncScheduler.cancelAll(getContext());
            s.forget();
            o.put("switched", true);
            new Thread(() -> {
                try {
                    if (token != null && base != null) new HttpUploader(base, token, debug).revokeSelf(deviceId);
                } catch (Exception ignored) {
                }
            }).start();
        } else {
            o.put("switched", false);
            if (s.enabled()) {
                s.setSignedOut(false);
                if (!s.paused()) {
                    SyncScheduler.schedulePeriodic(getContext());
                    SyncScheduler.catchUpIfStale(getContext());
                }
            }
        }
        call.resolve(o);
    }
}
