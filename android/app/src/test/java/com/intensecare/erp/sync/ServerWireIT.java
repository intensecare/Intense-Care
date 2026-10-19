package com.intensecare.erp.sync;

import static org.junit.Assume.assumeNotNull;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.intensecare.erp.sync.TestSupport.FakeClock;
import com.intensecare.erp.sync.TestSupport.FakeSource;
import com.intensecare.erp.sync.TestSupport.MemStore;
import org.junit.Test;

/**
 * Wire check against a REAL running ERP server (skipped unless ERP_BASE_URL and ERP_DEVICE_TOKEN are set):
 * the Java engine + HttpUploader sync contacts into the real API, a repeat run changes nothing, and an edit
 * is an update — not a duplicate. Run it with scripts/mobile-wire-check.sh.
 */
public class ServerWireIT {
    @Test
    public void javaClientSyncsIntoTheRealServer() throws Exception {
        String base = System.getenv("ERP_BASE_URL");
        String token = System.getenv("ERP_DEVICE_TOKEN");
        assumeNotNull(base, token);
        FakeSource src = new FakeSource();
        for (int i = 0; i < 230; i++) src.contacts.add(TestSupport.contact("w" + i, "Wire Person " + i, String.format("+9197%08d", 20000000 + i)));
        src.contacts.add(TestSupport.contact("wdup", "Wire Dup", "09700000000", "+91 97000-00000")); // same number twice
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        SyncEngine engine = new SyncEngine(src, new HttpUploader(base, token, true), store, clock, "91");

        RunSummary first = engine.run("MANUAL");
        assertTrue("first run failed: " + first.errorCode, first.ok);
        assertEquals("INITIAL", first.trigger);
        assertEquals(231, first.added);
        assertEquals(0, first.failed);
        assertEquals(231, store.snap.size());

        clock.t += 3_600_000;
        RunSummary again = engine.run("SCHEDULED");
        assertTrue(again.ok);
        assertEquals(0, again.added);
        assertEquals(0, again.updated);

        src.contacts.set(0, TestSupport.contact("w0", "Wire Person Zero Renamed", "+919700000099"));
        src.contacts.remove(1);
        clock.t += 3_600_000;
        RunSummary edit = engine.run("SCHEDULED");
        assertTrue(edit.ok);
        assertEquals(1, edit.updated);
        assertEquals(0, edit.added);
        assertEquals(1, edit.removed);
    }
}
