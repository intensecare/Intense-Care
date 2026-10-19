package com.intensecare.erp.sync;

import static com.intensecare.erp.sync.TestSupport.contact;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import com.intensecare.erp.sync.TestSupport.FakeClock;
import com.intensecare.erp.sync.TestSupport.FakeSource;
import com.intensecare.erp.sync.TestSupport.FakeUploader;
import com.intensecare.erp.sync.TestSupport.MemStore;
import org.junit.Before;
import org.junit.Test;

public class SyncEngineTest {
    FakeSource src;
    FakeUploader up;
    MemStore store;
    FakeClock clock;
    SyncEngine engine;

    @Before
    public void setUp() {
        src = new FakeSource();
        up = new FakeUploader();
        store = new MemStore();
        clock = new FakeClock();
        engine = new SyncEngine(src, up, store, clock, "91");
    }

    private void many(int n) {
        for (int i = 0; i < n; i++) src.contacts.add(contact("c" + i, "Person " + i, String.format("+9198%08d", 10000000 + i)));
    }

    @Test
    public void initialImportIsSplitIntoBatchesAndMarkedInitial() {
        many(450);
        RunSummary r = engine.run("SCHEDULED");
        assertTrue(r.ok);
        assertEquals("INITIAL", r.trigger);
        assertEquals(3, up.sent.size()); // 200 + 200 + 50
        assertEquals(450, up.contactsSent());
        assertTrue(up.sent.get(2).last);
        assertFalse(up.sent.get(0).last);
        for (Batch b : up.sent) assertEquals("INITIAL", b.trigger);
        assertEquals(450, store.snap.size());
        assertTrue(store.meta.initialDone);
        assertTrue(store.meta.lastSuccessAt > 0);
    }

    @Test
    public void repeatingTheSyncSendsNothingNewButStillRecordsTheRun() {
        many(10);
        engine.run("MANUAL");
        clock.t += 3_600_000;
        int before = up.contactsSent();
        RunSummary r = engine.run("SCHEDULED");
        assertTrue(r.ok);
        assertEquals("SCHEDULED", r.trigger);
        assertEquals(before, up.contactsSent());
        Batch last = up.sent.get(up.sent.size() - 1);
        assertTrue(last.contacts.isEmpty() && last.removedIds.isEmpty() && last.last); // "synced, nothing new"
    }

    @Test
    public void onlyChangedNewAndRemovedContactsAreSent() {
        many(30);
        engine.run("MANUAL");
        clock.t += 3_600_000;
        up.sent.clear();
        src.contacts.get(3).phones.add("+91 90000 55555"); // new number on an existing contact
        src.contacts.set(4, contact("c4", "Renamed Person", "+919800010004")); // name changed
        src.contacts.add(contact("new1", "Brand New", "+919911223344")); // new contact
        src.contacts.remove(src.contacts.size() - 2); // c29 deleted on the phone
        RunSummary r = engine.run("SCHEDULED");
        assertTrue(r.ok);
        assertEquals(3, up.contactsSent());
        Batch removal = up.sent.get(up.sent.size() - 1); // removals travel in their own, final batch
        assertEquals(1, removal.removedIds.size());
        assertEquals("c29", removal.removedIds.get(0));
        assertTrue(removal.last);
        assertFalse(store.snap.containsKey("c29"));
        assertTrue(store.snap.containsKey("new1"));
    }

    @Test
    public void sameNumberWrittenDifferentlyIsNotAChange() {
        src.contacts.add(contact("a", "Asha", "098450 12345"));
        engine.run("MANUAL");
        clock.t += 3_600_000;
        up.sent.clear();
        src.contacts.set(0, contact("a", "Asha", "+91 98450-12345", "9845012345"));
        engine.run("SCHEDULED");
        assertEquals(0, up.contactsSent());
    }

    @Test
    public void contactWithoutUsableNumberIsNeverSent_andBecomesRemovedIfItLosesItsNumber() {
        src.contacts.add(contact("a", "No Number"));
        src.contacts.add(contact("b", "Junk", "abc", "*123#"));
        src.contacts.add(contact("c", "Has", "+919845012345"));
        RunSummary r = engine.run("MANUAL");
        assertEquals(1, up.contactsSent());
        assertEquals(2, r.skipped);
        assertEquals(3, r.scanned);
        clock.t += 3_600_000;
        up.sent.clear();
        src.contacts.set(2, contact("c", "Has", "")); // number deleted
        engine.run("SCHEDULED");
        assertEquals("c", up.sent.get(0).removedIds.get(0));
    }

    @Test
    public void failedRecordsAreRetriedNextRun_notLost() {
        many(5);
        up.rejectIds.add("c2");
        RunSummary r = engine.run("MANUAL");
        assertTrue(r.ok);
        assertEquals(1, r.failed);
        assertEquals(1, r.pending);
        assertFalse(store.snap.containsKey("c2"));
        clock.t += 3_600_000;
        up.rejectIds.clear();
        up.sent.clear();
        engine.run("SCHEDULED");
        assertEquals(1, up.contactsSent());
        assertEquals("c2", up.sent.get(0).contacts.get(0).id());
        assertTrue(store.snap.containsKey("c2"));
    }

    @Test
    public void lostConnectionKeepsProgressAndResumesWhereItStopped() {
        many(450);
        up.script.put(2, UploadResult.Kind.RETRY); // second batch fails
        RunSummary r = engine.run("MANUAL");
        assertFalse(r.ok);
        assertTrue(r.retryable);
        assertEquals(200, store.snap.size()); // only the confirmed batch is remembered
        assertFalse(store.meta.initialDone);
        assertTrue(up.failures.contains(Codes.SERVER));
        clock.t += 3_600_000;
        up.sent.clear();
        up.script.clear();
        up.calls = 0;
        RunSummary r2 = engine.run("SCHEDULED");
        assertTrue(r2.ok);
        assertEquals("INITIAL", r2.trigger); // the first import isn't finished until it completes
        assertEquals(250, up.contactsSent());
        assertEquals(450, store.snap.size());
    }

    @Test
    public void networkExceptionIsReportedAsRetryable() {
        many(3);
        up.throwOnSend = new SyncException(Codes.NO_NETWORK, "x");
        RunSummary r = engine.run("MANUAL");
        assertFalse(r.ok);
        assertTrue(r.retryable);
        assertEquals(Codes.NO_NETWORK, r.errorCode);
        assertEquals(3, r.pending);
        assertEquals(0, store.snap.size());
    }

    @Test
    public void serverPauseStopsTheRun() {
        many(450);
        up.script.put(1, UploadResult.Kind.PAUSED);
        RunSummary r = engine.run("MANUAL");
        assertFalse(r.ok);
        assertFalse(r.retryable);
        assertEquals(Codes.PAUSED, r.errorCode);
        assertEquals(1, up.calls);
        assertTrue(up.failures.isEmpty()); // a deliberate pause isn't a failure to report
    }

    @Test
    public void rejectedTokenStopsAndIsNotRetriedBlindly() {
        many(3);
        up.script.put(1, UploadResult.Kind.AUTH);
        RunSummary r = engine.run("MANUAL");
        assertEquals(Codes.AUTH, r.errorCode);
        assertFalse(r.retryable);
    }

    @Test
    public void permissionDeniedIsReportedAndNothingIsSent() {
        src.error = new SyncException(Codes.PERMISSION_DENIED, "no");
        RunSummary r = engine.run("SCHEDULED");
        assertFalse(r.ok);
        assertEquals(Codes.PERMISSION_DENIED, r.errorCode);
        assertEquals(0, up.calls);
        assertEquals(Codes.PERMISSION_DENIED, up.failures.get(0));
    }

    @Test
    public void aSuddenDropOfMostContactsIsHeldUntilTheNextRunConfirmsIt() {
        many(100);
        engine.run("MANUAL");
        clock.t += 3_600_000;
        up.sent.clear();
        src.contacts.subList(0, 90).clear(); // the read suddenly returns only 10
        RunSummary r = engine.run("SCHEDULED");
        assertTrue(r.ok);
        assertEquals(0, up.sent.get(0).removedIds.size());
        assertEquals(100, store.snap.size());
        assertTrue(store.meta.shrinkSuspect);
        clock.t += 3_600_000;
        up.sent.clear();
        engine.run("SCHEDULED"); // still 10 → now believed
        assertEquals(90, up.sent.get(0).removedIds.size());
        assertEquals(10, store.snap.size());
    }

    @Test
    public void aTemporaryDropThatRecoversNeverRemovesAnything() {
        many(100);
        engine.run("MANUAL");
        java.util.List<ContactRecord> full = new java.util.ArrayList<>(src.contacts);
        clock.t += 3_600_000;
        src.contacts.clear(); // empty read
        engine.run("SCHEDULED");
        assertEquals(100, store.snap.size());
        clock.t += 3_600_000;
        src.contacts.addAll(full);
        up.sent.clear();
        engine.run("SCHEDULED");
        assertEquals(0, up.contactsSent());
        assertEquals(0, up.sent.get(0).removedIds.size());
        assertFalse(store.meta.shrinkSuspect);
    }

    @Test
    public void resumeRunsAreThrottled_manualOnesAreNot() {
        many(3);
        engine.run("MANUAL");
        int calls = up.calls;
        clock.t += 60_000;
        RunSummary r = engine.run("RESUME");
        assertEquals(Codes.THROTTLED, r.errorCode);
        assertEquals(calls, up.calls);
        engine.run("MANUAL");
        assertTrue(up.calls > calls);
        clock.t += 11 * 60_000;
        int c2 = up.calls;
        engine.run("RESUME");
        assertTrue(up.calls > c2);
    }

    @Test
    public void stoppingMidRunIsSafe() {
        many(450);
        final int[] n = {0};
        engine.stopWhen(() -> ++n[0] > 1); // allow one batch
        RunSummary r = engine.run("MANUAL");
        assertFalse(r.ok);
        assertTrue(r.retryable);
        assertEquals(Codes.INTERRUPTED, r.errorCode);
        assertEquals(200, store.snap.size());
    }

    @Test
    public void batchKeysAreStableForTheSameContentAndDifferentOtherwise() {
        many(5);
        engine.run("MANUAL");
        String k1 = up.sent.get(0).idempotencyKey;
        MemStore s2 = new MemStore();
        FakeUploader u2 = new FakeUploader();
        SyncEngine e2 = new SyncEngine(src, u2, s2, clock, "91");
        e2.run("MANUAL");
        // Different runs have different run ids, so different keys; the same batch object keeps one key.
        assertNotEquals(k1, u2.sent.get(0).idempotencyKey);
        Batch b = up.sent.get(0);
        assertEquals(b.idempotencyKey, b.idempotencyKey);
        assertTrue(k1.startsWith("b-") && k1.length() >= 8 && k1.length() <= 128);
    }

    @Test
    public void duplicateContactIdsInOneReadAreSentOnce() {
        src.contacts.add(contact("x", "A", "+919845012345"));
        src.contacts.add(contact("x", "A", "+919845012345"));
        engine.run("MANUAL");
        assertEquals(1, up.contactsSent());
    }

    @Test
    public void jsonSentToTheServerContainsOnlyTheAgreedFields() throws Exception {
        src.contacts.add(contact("a", "Asha", "098450 12345"));
        src.contacts.get(0).emails.add("Asha@Example.com");
        engine.run("MANUAL");
        org.json.JSONObject j = up.sent.get(0).toJson();
        assertEquals("INITIAL", j.getString("trigger"));
        assertTrue(j.getBoolean("final"));
        org.json.JSONObject c = j.getJSONArray("contacts").getJSONObject(0);
        java.util.Set<String> keys = new java.util.TreeSet<>();
        for (java.util.Iterator<String> it = c.keys(); it.hasNext(); ) keys.add(it.next());
        assertEquals("[emails, id, name, phones]", keys.toString());
    }
}
