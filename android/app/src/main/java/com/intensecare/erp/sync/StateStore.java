package com.intensecare.erp.sync;

import java.util.Map;

/** Where the engine keeps what the server has already confirmed. Implementations must keep it private to the app. */
public interface StateStore {
    /** device contact id → content hash, for every contact the server has acknowledged. */
    Map<String, String> loadSnapshot();

    void saveSnapshot(Map<String, String> snapshot);

    Meta loadMeta();

    void saveMeta(Meta meta);

    /** Run bookkeeping that isn't a secret. */
    final class Meta {
        public long lastAttemptAt;
        public long lastSuccessAt;
        /** The first full import finished — until then every run is reported as INITIAL (no automatic leads). */
        public boolean initialDone;
        /** The last read showed a big drop in contacts; removals are held until the next run confirms it. */
        public boolean shrinkSuspect;
        public RunSummary lastRun;
    }
}
