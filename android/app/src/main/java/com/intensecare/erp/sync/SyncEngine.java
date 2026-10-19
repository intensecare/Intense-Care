package com.intensecare.erp.sync;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The contact-sync algorithm, free of Android classes so it runs (and is tested) on a plain JVM.
 *
 * Why it is safe to run repeatedly:
 *  - The snapshot only ever contains what the SERVER acknowledged, so anything unsent, failed or interrupted is
 *    simply "changed" again on the next run — nothing is queued that could go stale, and nothing is lost.
 *  - Batches carry an idempotency key derived from their content: a request repeated after a lost response is a no-op.
 *  - Contacts are tracked by the phone's own contact id, never by name. Removing a contact marks it removed in the ERP;
 *    it never deletes a customer or lead (the server enforces that too).
 *  - A sudden drop of most contacts (a failed read, an account being re-synced) is held for one more run before
 *    removals are sent, so a glitch can't wipe the directory.
 */
public final class SyncEngine {
    public interface Source {
        List<ContactRecord> readAll() throws SyncException;
    }

    public interface Uploader {
        UploadResult send(Batch batch) throws SyncException;

        /** Best effort: tell the server a run could not finish. Never throws. */
        void reportFailure(String runId, String trigger, String errorCode, int scanned);
    }

    public interface Clock {
        long now();
    }

    private java.util.function.BooleanSupplier stopCheck = () -> false;

    /** WorkManager may stop a worker (10-minute limit, battery, constraints). Checked between batches; progress is already saved. */
    public SyncEngine stopWhen(java.util.function.BooleanSupplier check) {
        this.stopCheck = check;
        return this;
    }

    private static final long RESUME_THROTTLE_MS = 10 * 60 * 1000L;
    private static final int SHRINK_MIN_SNAPSHOT = 20;

    private final Source source;
    private final Uploader uploader;
    private final StateStore store;
    private final Clock clock;
    private final String countryCode;

    public SyncEngine(Source source, Uploader uploader, StateStore store, Clock clock, String countryCode) {
        this.source = source;
        this.uploader = uploader;
        this.store = store;
        this.clock = clock;
        this.countryCode = countryCode;
    }

    public RunSummary run(String requestedTrigger) {
        long now = clock.now();
        StateStore.Meta meta = store.loadMeta();
        RunSummary out = new RunSummary();
        out.at = now;
        out.trigger = requestedTrigger;

        boolean passive = "RESUME".equals(requestedTrigger) || "APP_OPEN".equals(requestedTrigger);
        if (passive && meta.lastAttemptAt > 0 && now - meta.lastAttemptAt < RESUME_THROTTLE_MS) {
            out.ok = true;
            out.errorCode = Codes.THROTTLED;
            return out; // not stored: it is not a real run
        }
        meta.lastAttemptAt = now;

        String runId = "r" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        Map<String, String> snapshot = new LinkedHashMap<>(store.loadSnapshot());
        // Until the first full import has completed, every run counts as the initial import.
        String trigger = !meta.initialDone ? "INITIAL" : requestedTrigger;
        out.trigger = trigger;

        // 1. Read the phone.
        List<ContactRecord> raw;
        try {
            raw = source.readAll();
        } catch (SyncException e) {
            return fail(out, meta, runId, trigger, e.code, 0, false);
        }
        Map<String, PreparedContact> current = new LinkedHashMap<>();
        int skipped = 0;
        for (ContactRecord r : raw) {
            PreparedContact p = PreparedContact.prepare(r, countryCode);
            if (p == null) skipped++;
            else current.putIfAbsent(p.id(), p);
        }
        out.scanned = raw.size();
        out.skipped = skipped;

        // 2. What changed since the server last confirmed?
        List<PreparedContact> changed = new ArrayList<>();
        for (PreparedContact p : current.values()) {
            String known = snapshot.get(p.id());
            if (known == null || !known.equals(p.hash)) changed.add(p);
        }
        List<String> removed = new ArrayList<>();
        for (String id : snapshot.keySet()) if (!current.containsKey(id)) removed.add(id);

        // 3. A big drop is held until a second run sees it too.
        boolean heldRemovals = false;
        if (snapshot.size() >= SHRINK_MIN_SNAPSHOT && removed.size() * 2 > snapshot.size()) {
            if (!meta.shrinkSuspect) {
                meta.shrinkSuspect = true;
                removed.clear();
                heldRemovals = true;
            }
        } else {
            meta.shrinkSuspect = false;
        }

        // 4. Send, batch by batch; the snapshot advances only for what the server confirmed.
        List<Batch> batches = Batch.plan(runId, trigger, out.scanned, changed, removed, 0);
        Map<String, PreparedContact> byId = new HashMap<>();
        for (PreparedContact p : changed) byId.put(p.id(), p);
        Set<String> failedIds = new HashSet<>();
        int sentBatches = 0;
        for (Batch b : batches) {
            if (stopCheck.getAsBoolean()) return fail(out, meta, runId, trigger, Codes.INTERRUPTED, out.scanned, true, snapshot, changed, removed, failedIds);
            UploadResult r;
            try {
                r = uploader.send(b);
            } catch (SyncException e) {
                return fail(out, meta, runId, trigger, e.code, out.scanned, true, snapshot, changed, removed, failedIds);
            }
            if (r.kind == UploadResult.Kind.PAUSED) return fail(out, meta, runId, trigger, Codes.PAUSED, out.scanned, false, snapshot, changed, removed, failedIds);
            if (r.kind == UploadResult.Kind.AUTH) return fail(out, meta, runId, trigger, Codes.AUTH, out.scanned, false, snapshot, changed, removed, failedIds);
            if (r.kind == UploadResult.Kind.RETRY) return fail(out, meta, runId, trigger, Codes.SERVER, out.scanned, true, snapshot, changed, removed, failedIds);
            if (r.kind == UploadResult.Kind.REJECTED) {
                // The server refused this whole batch (it will never accept it): count it, keep going with the rest.
                for (PreparedContact p : b.contacts) failedIds.add(p.id());
                out.failed += b.contacts.size();
                continue;
            }
            sentBatches++;
            Set<String> bad = new HashSet<>(r.failedIds);
            for (PreparedContact p : b.contacts) {
                if (bad.contains(p.id())) failedIds.add(p.id());
                else snapshot.put(p.id(), p.hash);
            }
            for (String id : b.removedIds) snapshot.remove(id);
            out.added += r.added;
            out.updated += r.updated;
            out.removed += r.removed;
            out.duplicates = Math.max(out.duplicates, r.duplicates);
            out.failed += bad.size();
            store.saveSnapshot(snapshot);
            if (!r.nextBatchAllowed) return fail(out, meta, runId, trigger, Codes.PAUSED, out.scanned, false, snapshot, changed, removed, failedIds);
        }

        // 5. Done.
        out.ok = true;
        out.pending = failedIds.size() + (heldRemovals ? 1 : 0);
        meta.initialDone = true;
        meta.lastSuccessAt = now;
        meta.lastRun = out;
        store.saveSnapshot(snapshot);
        store.saveMeta(meta);
        return out;
    }

    private RunSummary fail(RunSummary out, StateStore.Meta meta, String runId, String trigger, String code, int scanned, boolean retryable) {
        return fail(out, meta, runId, trigger, code, scanned, retryable, null, null, null, null);
    }

    private RunSummary fail(RunSummary out, StateStore.Meta meta, String runId, String trigger, String code, int scanned, boolean retryable, Map<String, String> snapshot, List<PreparedContact> changed, List<String> removed, Set<String> failedIds) {
        out.ok = false;
        out.retryable = retryable;
        out.errorCode = code;
        if (snapshot != null) {
            int unsent = 0;
            for (PreparedContact p : changed) if (!p.hash.equals(snapshot.get(p.id()))) unsent++;
            for (String id : removed) if (snapshot.containsKey(id)) unsent++;
            out.pending = unsent;
        }
        meta.lastRun = out;
        store.saveMeta(meta);
        // The server can't know a run died unless told. Codes only.
        if (!Codes.AUTH.equals(code) && !Codes.PAUSED.equals(code)) uploader.reportFailure(runId, trigger, code, scanned);
        return out;
    }
}
