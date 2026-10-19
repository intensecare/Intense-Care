package com.intensecare.erp.sync.android;

import com.intensecare.erp.sync.Codes;
import com.intensecare.erp.sync.HttpUploader;
import com.intensecare.erp.sync.RunSummary;
import com.intensecare.erp.sync.SyncEngine;
import com.intensecare.erp.sync.SyncException;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/**
 * Runs one sync, from either the app (Sync Now / resume) or WorkManager (scheduled). Only one runs at a time in
 * the process; a second request while one is running is skipped — the running one already covers it.
 */
public final class SyncRunner {
    public interface Listener {
        void onChanged();
    }

    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
    private static volatile Listener listener;

    private SyncRunner() {}

    public static void setListener(Listener l) {
        listener = l;
    }

    public static boolean isRunning() {
        return RUNNING.get();
    }

    private static void changed() {
        Listener l = listener;
        if (l != null) l.onChanged();
    }

    /** Fire-and-forget (used while the app is open). @return false if a sync was already running. */
    public static boolean runAsync(final Context ctx, final String trigger) {
        if (RUNNING.get()) return false;
        POOL.execute(() -> runBlocking(ctx, trigger, () -> false));
        return true;
    }

    /** Blocks until done. Never throws. */
    public static RunSummary runBlocking(Context ctx, String trigger, BooleanSupplier stopped) {
        RunSummary skipped = new RunSummary();
        skipped.at = System.currentTimeMillis();
        skipped.trigger = trigger;
        if (!RUNNING.compareAndSet(false, true)) {
            skipped.ok = true;
            skipped.errorCode = Codes.BUSY;
            return skipped;
        }
        changed();
        try {
            Context app = ctx.getApplicationContext();
            SyncSettings s = new SyncSettings(app);
            String token = s.token();
            if (!s.enabled() || token == null || s.baseUrl() == null) {
                skipped.ok = true;
                skipped.errorCode = "OFF";
                return skipped;
            }
            if (s.paused() || s.signedOut()) {
                skipped.ok = true;
                skipped.errorCode = Codes.PAUSED;
                return skipped;
            }
            boolean debug = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            SyncEngine engine = new SyncEngine(new AndroidContactSource(app), new HttpUploader(s.baseUrl(), token, debug), s.store(), System::currentTimeMillis, "91").stopWhen(stopped);
            RunSummary r = engine.run(trigger);
            // The ERP can switch this phone off from its side (Pause on the web, or an Admin disconnecting it).
            if (Codes.PAUSED.equals(r.errorCode)) s.setPaused(true);
            return r;
        } catch (SyncException e) {
            RunSummary r = new RunSummary();
            r.at = System.currentTimeMillis();
            r.trigger = trigger;
            r.errorCode = e.code;
            return r;
        } catch (RuntimeException e) {
            RunSummary r = new RunSummary();
            r.at = System.currentTimeMillis();
            r.trigger = trigger;
            r.errorCode = Codes.READ_FAILED;
            r.retryable = true;
            return r;
        } finally {
            RUNNING.set(false);
            changed();
        }
    }
}
