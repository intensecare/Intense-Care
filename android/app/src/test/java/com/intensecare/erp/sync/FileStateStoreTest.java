package com.intensecare.erp.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;

public class FileStateStoreTest {
    private static AesGcmBox box() throws Exception {
        KeyGenerator g = KeyGenerator.getInstance("AES");
        g.init(256);
        final SecretKey k = g.generateKey();
        return new AesGcmBox(() -> k);
    }

    private static File tmp() throws Exception {
        return Files.createTempDirectory("sync-state").toFile();
    }

    @Test
    public void snapshotRoundTripsAndIsNotStoredInTheClear() throws Exception {
        File dir = tmp();
        FileStateStore s = new FileStateStore(dir, box());
        Map<String, String> snap = new LinkedHashMap<>();
        snap.put("c1", "abc123hash");
        s.saveSnapshot(snap);
        assertEquals(snap, s.loadSnapshot());
        String raw = new String(Files.readAllBytes(new File(dir, "snapshot.enc").toPath()), StandardCharsets.ISO_8859_1);
        assertFalse(raw.contains("abc123hash"));
        assertFalse(raw.contains("c1"));
    }

    @Test
    public void tamperedOrUnreadableSnapshotMeansStartOver_neverACrash() throws Exception {
        File dir = tmp();
        FileStateStore s = new FileStateStore(dir, box());
        Map<String, String> snap = new LinkedHashMap<>();
        snap.put("c1", "h");
        s.saveSnapshot(snap);
        byte[] b = Files.readAllBytes(new File(dir, "snapshot.enc").toPath());
        b[b.length - 1] ^= 1;
        Files.write(new File(dir, "snapshot.enc").toPath(), b);
        assertTrue(s.loadSnapshot().isEmpty());
        // A different key (e.g. after a device restore) also reads as empty.
        s.saveSnapshot(snap);
        assertTrue(new FileStateStore(dir, box()).loadSnapshot().isEmpty());
    }

    @Test
    public void metaRoundTripsWithoutAnyPersonalData() throws Exception {
        File dir = tmp();
        FileStateStore s = new FileStateStore(dir, box());
        StateStore.Meta m = new StateStore.Meta();
        m.lastAttemptAt = 5;
        m.lastSuccessAt = 4;
        m.initialDone = true;
        m.shrinkSuspect = true;
        m.lastRun = new RunSummary();
        m.lastRun.added = 7;
        m.lastRun.errorCode = Codes.NO_NETWORK;
        s.saveMeta(m);
        StateStore.Meta r = s.loadMeta();
        assertEquals(4, r.lastSuccessAt);
        assertTrue(r.initialDone && r.shrinkSuspect);
        assertEquals(7, r.lastRun.added);
        assertEquals(Codes.NO_NETWORK, r.lastRun.errorCode);
    }

    @Test
    public void clearForgetsEverything() throws Exception {
        File dir = tmp();
        FileStateStore s = new FileStateStore(dir, box());
        Map<String, String> snap = new LinkedHashMap<>();
        snap.put("c1", "h");
        s.saveSnapshot(snap);
        s.saveMeta(new StateStore.Meta());
        s.clear();
        assertTrue(s.loadSnapshot().isEmpty());
        assertFalse(s.loadMeta().initialDone);
    }
}
