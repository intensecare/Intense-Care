package com.intensecare.erp.sync;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Talks to the ERP with the phone's scoped sync token (never the login session). HTTPS only — plain http is
 * accepted solely for debug builds against a developer machine. Redirects are not followed, so the token can
 * never be forwarded to another host.
 */
public final class HttpUploader implements SyncEngine.Uploader {
    private final String base;
    private final String token;

    public HttpUploader(String baseUrl, String token, boolean allowCleartext) throws SyncException {
        if (!urlAllowed(baseUrl, allowCleartext)) throw new SyncException(Codes.AUTH, "insecure server address");
        this.base = baseUrl.replaceAll("/+$", "");
        this.token = token;
    }

    public static boolean urlAllowed(String baseUrl, boolean allowCleartext) {
        if (baseUrl == null) return false;
        String u = baseUrl.trim().toLowerCase(java.util.Locale.ROOT);
        if (u.startsWith("https://")) return true;
        return allowCleartext && u.startsWith("http://");
    }

    @Override
    public UploadResult send(Batch b) throws SyncException {
        try {
            Response r = post("/api/mobile/contacts/sync", b.toJson().toString());
            return classify(r.code, r.body);
        } catch (JSONException e) {
            throw new SyncException(Codes.READ_FAILED, e);
        }
    }

    @Override
    public void reportFailure(String runId, String trigger, String errorCode, int scanned) {
        try {
            JSONObject o = new JSONObject();
            o.put("runId", runId);
            o.put("trigger", trigger);
            o.put("errorCode", errorCode);
            o.put("scanned", scanned);
            post("/api/mobile/contacts/failure", o.toString());
        } catch (Exception ignored) {
        }
    }

    /** Disconnect from the phone's side: invalidates this token on the server. */
    public boolean revokeSelf(String deviceId) {
        try {
            JSONObject o = new JSONObject();
            o.put("deviceId", deviceId);
            return post("/api/mobile/devices/revoke", o.toString()).code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    /** HTTP status → what the engine should do. Package-visible so it is unit-tested. */
    static UploadResult classify(int code, String body) throws SyncException {
        if (code == 200) {
            UploadResult r = new UploadResult(UploadResult.Kind.OK);
            try {
                JSONObject d = new JSONObject(body).getJSONObject("data");
                r.added = d.optInt("added");
                r.updated = d.optInt("updated");
                r.unchanged = d.optInt("unchanged");
                r.removed = d.optInt("removed");
                r.skipped = d.optInt("skipped");
                r.duplicates = d.optInt("duplicates");
                r.nextBatchAllowed = d.optBoolean("nextBatchAllowed", true);
                JSONArray failed = d.optJSONArray("failed");
                if (failed != null) for (int i = 0; i < failed.length(); i++) r.failedIds.add(failed.getJSONObject(i).optString("id"));
            } catch (JSONException e) {
                // A 200 we can't read (a captive portal, a proxy page): don't treat it as confirmed.
                throw new SyncException(Codes.SERVER, e);
            }
            return r;
        }
        if (code == 423) return new UploadResult(UploadResult.Kind.PAUSED);
        if (code == 401 || code == 403) return new UploadResult(UploadResult.Kind.AUTH);
        if (code == 408 || code == 429 || code >= 500) return new UploadResult(UploadResult.Kind.RETRY);
        if (code >= 300 && code < 400) throw new SyncException(Codes.SERVER, "unexpected redirect");
        return new UploadResult(UploadResult.Kind.REJECTED);
    }

    private static final class Response {
        int code;
        String body;
    }

    private Response post(String path, String json) throws SyncException {
        HttpURLConnection c = null;
        try {
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            c = (HttpURLConnection) java.net.URI.create(base + path).toURL().openConnection();
            c.setRequestMethod("POST");
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15_000);
            c.setReadTimeout(60_000);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(data.length);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream out = c.getOutputStream()) {
                out.write(data);
            }
            Response r = new Response();
            r.code = c.getResponseCode();
            InputStream in = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            r.body = in == null ? "" : readAll(in);
            return r;
        } catch (IOException e) {
            throw new SyncException(Codes.NO_NETWORK, e);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = i.read(buf)) > 0 && out.size() < 1_000_000) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
