package com.intensecare.erp.sync;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/**
 * Background scheduling with WorkManager. Android decides the exact run time (battery saver, Doze and standby buckets
 * can delay it), so the app never promises an interval: the periodic job is "about every 6 hours when the phone has
 * a connection", and a catch-up job runs soon after the app is opened if the last good sync is old.
 */
public final class SyncScheduler {
    public static final String PERIODIC = "ic-contact-sync-periodic";
    public static final String ONCE = "ic-contact-sync-once";
    public static final long PERIOD_HOURS = 6;
    public static final long STALE_MS = 12 * 60 * 60 * 1000L;

    private SyncScheduler() {}

    private static Constraints network() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    public static void schedulePeriodic(Context ctx) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(ContactSyncWorker.class, PERIOD_HOURS, TimeUnit.HOURS, 2, TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .setInputData(new Data.Builder().putString(ContactSyncWorker.KEY_TRIGGER, "SCHEDULED").build())
            .build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    /** A one-off run as soon as there is a connection (catch-up after a missed schedule, or a retry). */
    public static void runSoon(Context ctx, String trigger) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(ContactSyncWorker.class)
            .setConstraints(network())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .setInputData(new Data.Builder().putString(ContactSyncWorker.KEY_TRIGGER, trigger).build())
            .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, req);
    }

    /** If the last good sync is older than 12 h (or there never was one), schedule a catch-up. */
    public static void catchUpIfStale(Context ctx) {
        SyncSettings s = new SyncSettings(ctx);
        if (!s.enabled() || s.paused() || s.signedOut()) return;
        StateStore.Meta m = s.store().loadMeta();
        if (System.currentTimeMillis() - m.lastSuccessAt > STALE_MS) runSoon(ctx, m.initialDone ? "CATCH_UP" : "INITIAL");
    }

    public static void cancelAll(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx);
        wm.cancelUniqueWork(PERIODIC);
        wm.cancelUniqueWork(ONCE);
    }
}
