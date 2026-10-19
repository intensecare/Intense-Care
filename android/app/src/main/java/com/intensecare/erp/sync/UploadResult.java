package com.intensecare.erp.sync;

import java.util.ArrayList;
import java.util.List;

/** What the server said about one batch. */
public final class UploadResult {
    public enum Kind { OK, PAUSED, AUTH, RETRY, REJECTED }

    public final Kind kind;
    public int added, updated, unchanged, removed, skipped, duplicates;
    /** Device contact ids the server could not save (ids only — no names or numbers). */
    public final List<String> failedIds = new ArrayList<>();
    public boolean nextBatchAllowed = true;

    public UploadResult(Kind kind) {
        this.kind = kind;
    }
}
