package com.intensecare.erp.sync;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** The WorkManager entry point: runs one sync in the background, even when the app is closed. */
public class ContactSyncWorker extends Worker {
    public static final String KEY_TRIGGER = "trigger";

    public ContactSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String trigger = getInputData().getString(KEY_TRIGGER);
        RunSummary r = SyncRunner.runBlocking(getApplicationContext(), trigger == null ? "SCHEDULED" : trigger, this::isStopped);
        // Retry (with backoff) only when trying again could help: no connection, server busy, interrupted.
        return r.ok || !r.retryable ? Result.success() : Result.retry();
    }
}
