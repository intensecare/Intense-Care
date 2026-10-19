package com.intensecare.erp.sync;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** One upload: up to 200 changed contacts plus removed ids. Mirrors the server's SyncBatchRequest. */
public final class Batch {
    public static final int MAX_CONTACTS = 200;
    public static final int MAX_REMOVED = 500;

    public final String runId;
    public final String trigger;
    public final int index;
    public final int count;
    public final String idempotencyKey;
    public final int scannedTotal;
    public final List<PreparedContact> contacts;
    public final List<String> removedIds;
    public final int failedLocal;
    public final boolean last;

    Batch(String runId, String trigger, int index, int count, int scannedTotal, List<PreparedContact> contacts, List<String> removedIds, int failedLocal, boolean last) {
        this.runId = runId;
        this.trigger = trigger;
        this.index = index;
        this.count = count;
        this.scannedTotal = scannedTotal;
        this.contacts = contacts;
        this.removedIds = removedIds;
        this.failedLocal = failedLocal;
        this.last = last;
        // Same content in the same run → same key, so a request repeated after a lost response can't be applied twice.
        StringBuilder sb = new StringBuilder(runId).append('|').append(index).append('|').append(count);
        for (PreparedContact p : contacts) sb.append('|').append(p.id()).append(':').append(p.hash);
        for (String r : removedIds) sb.append("|-").append(r);
        this.idempotencyKey = "b-" + PreparedContact.sha256(sb.toString()).substring(0, 40);
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("runId", runId);
        o.put("trigger", trigger);
        o.put("batchIndex", index);
        o.put("batchCount", count);
        o.put("idempotencyKey", idempotencyKey);
        o.put("scannedTotal", scannedTotal);
        JSONArray arr = new JSONArray();
        for (PreparedContact p : contacts) {
            JSONObject c = new JSONObject();
            c.put("id", p.id());
            c.put("name", p.source.name);
            c.put("phones", new JSONArray(p.source.phones));
            if (!p.source.emails.isEmpty()) c.put("emails", new JSONArray(p.source.emails));
            if (p.source.updatedAt > 0) c.put("updatedAt", p.source.updatedAt);
            arr.put(c);
        }
        o.put("contacts", arr);
        o.put("removedIds", new JSONArray(removedIds));
        if (last && failedLocal > 0) o.put("failedLocal", failedLocal);
        o.put("final", last);
        return o;
    }

    /** Splits changed contacts and removals into batches. There is always at least one (an empty last batch records "synced, nothing new"). */
    public static List<Batch> plan(String runId, String trigger, int scanned, List<PreparedContact> changed, List<String> removed, int failedLocal) {
        int contactBatches = (changed.size() + MAX_CONTACTS - 1) / MAX_CONTACTS;
        int removalBatches = (removed.size() + MAX_REMOVED - 1) / MAX_REMOVED;
        int total = Math.max(1, contactBatches + removalBatches);
        List<Batch> out = new ArrayList<>();
        int idx = 0;
        for (int i = 0; i < contactBatches; i++) {
            List<PreparedContact> part = changed.subList(i * MAX_CONTACTS, Math.min(changed.size(), (i + 1) * MAX_CONTACTS));
            out.add(new Batch(runId, trigger, idx++, total, scanned, new ArrayList<>(part), new ArrayList<String>(), failedLocal, idx == total));
        }
        for (int i = 0; i < removalBatches; i++) {
            List<String> part = removed.subList(i * MAX_REMOVED, Math.min(removed.size(), (i + 1) * MAX_REMOVED));
            out.add(new Batch(runId, trigger, idx++, total, scanned, new ArrayList<PreparedContact>(), new ArrayList<>(part), failedLocal, idx == total));
        }
        if (out.isEmpty()) out.add(new Batch(runId, trigger, 0, 1, scanned, new ArrayList<PreparedContact>(), new ArrayList<String>(), failedLocal, true));
        return out;
    }
}
