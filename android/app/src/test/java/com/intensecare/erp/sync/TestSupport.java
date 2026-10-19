package com.intensecare.erp.sync;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** In-memory fakes for the engine tests. */
final class TestSupport {
    private TestSupport() {}

    static ContactRecord contact(String id, String name, String... phones) {
        ContactRecord c = new ContactRecord(id, name, 0);
        for (String p : phones) c.phones.add(p);
        return c;
    }

    static final class MemStore implements StateStore {
        Map<String, String> snap = new LinkedHashMap<>();
        Meta meta = new Meta();

        public Map<String, String> loadSnapshot() { return new LinkedHashMap<>(snap); }
        public void saveSnapshot(Map<String, String> s) { snap = new LinkedHashMap<>(s); }
        public Meta loadMeta() { return meta; }
        public void saveMeta(Meta m) { meta = m; }
    }

    static final class FakeSource implements SyncEngine.Source {
        List<ContactRecord> contacts = new ArrayList<>();
        SyncException error;

        public List<ContactRecord> readAll() throws SyncException {
            if (error != null) throw error;
            return new ArrayList<>(contacts);
        }
    }

    static final class FakeUploader implements SyncEngine.Uploader {
        final List<Batch> sent = new ArrayList<>();
        final List<String> failures = new ArrayList<>();
        /** Per-send scripted outcome by call number (1-based); default OK. */
        final Map<Integer, UploadResult.Kind> script = new HashMap<>();
        final List<String> rejectIds = new ArrayList<>();
        SyncException throwOnSend;
        int calls;

        public UploadResult send(Batch b) throws SyncException {
            calls++;
            if (throwOnSend != null) throw throwOnSend;
            UploadResult.Kind k = script.getOrDefault(calls, UploadResult.Kind.OK);
            UploadResult r = new UploadResult(k);
            if (k == UploadResult.Kind.OK) {
                sent.add(b);
                r.added = b.contacts.size();
                for (PreparedContact p : b.contacts) if (rejectIds.contains(p.id())) r.failedIds.add(p.id());
                r.removed = b.removedIds.size();
            }
            return r;
        }

        public void reportFailure(String runId, String trigger, String errorCode, int scanned) {
            failures.add(errorCode);
        }

        int contactsSent() {
            int n = 0;
            for (Batch b : sent) n += b.contacts.size();
            return n;
        }
    }

    static final class FakeClock implements SyncEngine.Clock {
        long t = 1_000_000_000L;
        public long now() { return t; }
    }
}
