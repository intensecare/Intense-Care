package com.intensecare.erp.sync;

import org.json.JSONException;
import org.json.JSONObject;

/** The outcome of one sync run, kept on the phone for the Contact Sync screen. Counts and codes only. */
public final class RunSummary {
    public long at;
    public String trigger = "";
    public boolean ok;
    /** True when trying again later may succeed (no network, server busy). */
    public boolean retryable;
    public String errorCode;
    public int scanned, added, updated, removed, skipped, duplicates, failed;
    /** Changes still waiting to be confirmed by the server. */
    public int pending;

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("at", at);
        o.put("trigger", trigger);
        o.put("ok", ok);
        o.put("errorCode", errorCode == null ? JSONObject.NULL : errorCode);
        o.put("scanned", scanned);
        o.put("added", added);
        o.put("updated", updated);
        o.put("removed", removed);
        o.put("skipped", skipped);
        o.put("duplicates", duplicates);
        o.put("failed", failed);
        o.put("pending", pending);
        return o;
    }

    public static RunSummary fromJson(JSONObject o) {
        RunSummary r = new RunSummary();
        r.at = o.optLong("at");
        r.trigger = o.optString("trigger");
        r.ok = o.optBoolean("ok");
        r.errorCode = o.isNull("errorCode") ? null : o.optString("errorCode");
        r.scanned = o.optInt("scanned");
        r.added = o.optInt("added");
        r.updated = o.optInt("updated");
        r.removed = o.optInt("removed");
        r.skipped = o.optInt("skipped");
        r.duplicates = o.optInt("duplicates");
        r.failed = o.optInt("failed");
        r.pending = o.optInt("pending");
        return r;
    }
}
