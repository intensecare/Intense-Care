package com.intensecare.erp.sync;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sync state on disk. The snapshot (contact id → hash of the contact's content) is encrypted, because a hash of a
 * phone number can be guessed; the run bookkeeping (times, counts, codes) holds nothing personal and is plain JSON.
 * Writes go to a temp file and are renamed, so a crash mid-write can't corrupt the state.
 */
public final class FileStateStore implements StateStore {
    private final File dir;
    private final SecretBox box;

    public FileStateStore(File dir, SecretBox box) {
        this.dir = dir;
        this.box = box;
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    @Override
    public synchronized Map<String, String> loadSnapshot() {
        Map<String, String> out = new LinkedHashMap<>();
        try {
            byte[] sealed = read(new File(dir, "snapshot.enc"));
            if (sealed == null) return out;
            JSONObject o = new JSONObject(new String(box.open(sealed), StandardCharsets.UTF_8));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                out.put(k, o.getString(k));
            }
        } catch (Exception e) {
            // Unreadable (key lost after a restore, corrupt file): start over — the next run re-compares everything,
            // and the server de-duplicates by contact id, so nothing is added twice.
            out.clear();
        }
        return out;
    }

    @Override
    public synchronized void saveSnapshot(Map<String, String> snapshot) {
        try {
            byte[] sealed = box.seal(new JSONObject(snapshot).toString().getBytes(StandardCharsets.UTF_8));
            write(new File(dir, "snapshot.enc"), sealed);
        } catch (Exception e) {
            // Not saved: the worst case is a harmless re-send next time.
        }
    }

    @Override
    public synchronized Meta loadMeta() {
        Meta m = new Meta();
        try {
            byte[] b = read(new File(dir, "meta.json"));
            if (b == null) return m;
            JSONObject o = new JSONObject(new String(b, StandardCharsets.UTF_8));
            m.lastAttemptAt = o.optLong("lastAttemptAt");
            m.lastSuccessAt = o.optLong("lastSuccessAt");
            m.initialDone = o.optBoolean("initialDone");
            m.shrinkSuspect = o.optBoolean("shrinkSuspect");
            JSONObject lr = o.optJSONObject("lastRun");
            if (lr != null) m.lastRun = RunSummary.fromJson(lr);
        } catch (Exception ignored) {
        }
        return m;
    }

    @Override
    public synchronized void saveMeta(Meta m) {
        try {
            JSONObject o = new JSONObject();
            o.put("lastAttemptAt", m.lastAttemptAt);
            o.put("lastSuccessAt", m.lastSuccessAt);
            o.put("initialDone", m.initialDone);
            o.put("shrinkSuspect", m.shrinkSuspect);
            if (m.lastRun != null) o.put("lastRun", m.lastRun.toJson());
            write(new File(dir, "meta.json"), o.toString().getBytes(StandardCharsets.UTF_8));
        } catch (JSONException | IOException ignored) {
        }
    }

    /** Forget everything (disconnect). */
    public synchronized void clear() {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private static byte[] read(File f) throws IOException {
        if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static void write(File f, byte[] data) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            if (!tmp.renameTo(f)) throw new IOException("rename failed");
        }
    }
}
