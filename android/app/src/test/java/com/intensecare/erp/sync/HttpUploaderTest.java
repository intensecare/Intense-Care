package com.intensecare.erp.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class HttpUploaderTest {
    @Test
    public void onlyHttpsIsAllowedUnlessDebug() {
        assertTrue(HttpUploader.urlAllowed("https://erp.example.com", false));
        assertFalse(HttpUploader.urlAllowed("http://erp.example.com", false));
        assertTrue(HttpUploader.urlAllowed("http://10.0.2.2:3000", true));
        assertFalse(HttpUploader.urlAllowed("ftp://x", true));
        assertFalse(HttpUploader.urlAllowed(null, true));
    }

    @Test
    public void refusesToBeBuiltForPlainHttp() {
        try {
            new HttpUploader("http://erp.example.com", "icd_x", false);
            fail("should refuse");
        } catch (SyncException e) {
            assertEquals(Codes.AUTH, e.code);
        }
    }

    @Test
    public void statusCodesMapToEngineDecisions() throws Exception {
        String ok = "{\"success\":true,\"data\":{\"added\":2,\"updated\":1,\"failed\":[{\"id\":\"c9\",\"code\":\"SAVE_FAILED\"}],\"nextBatchAllowed\":true,\"duplicates\":3}}";
        UploadResult r = HttpUploader.classify(200, ok);
        assertEquals(UploadResult.Kind.OK, r.kind);
        assertEquals(2, r.added);
        assertEquals(3, r.duplicates);
        assertEquals("c9", r.failedIds.get(0));
        assertEquals(UploadResult.Kind.PAUSED, HttpUploader.classify(423, "").kind);
        assertEquals(UploadResult.Kind.AUTH, HttpUploader.classify(401, "").kind);
        assertEquals(UploadResult.Kind.AUTH, HttpUploader.classify(403, "").kind);
        assertEquals(UploadResult.Kind.RETRY, HttpUploader.classify(503, "").kind);
        assertEquals(UploadResult.Kind.RETRY, HttpUploader.classify(429, "").kind);
        assertEquals(UploadResult.Kind.REJECTED, HttpUploader.classify(400, "").kind);
        try {
            HttpUploader.classify(200, "<html>captive portal</html>");
            fail("an unreadable 200 must not count as confirmed");
        } catch (SyncException e) {
            assertEquals(Codes.SERVER, e.code);
        }
        try {
            HttpUploader.classify(302, "");
            fail("redirects must not be followed");
        } catch (SyncException e) {
            assertEquals(Codes.SERVER, e.code);
        }
    }

    @Test
    public void sendsBearerTokenAndJsonToTheSyncEndpoint() throws Exception {
        final List<String> seen = new ArrayList<>();
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream in = ex.getRequestBody()) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) body.write(buf, 0, n);
            }
            seen.add(ex.getRequestMethod() + " " + ex.getRequestURI().getPath() + " auth=" + ex.getRequestHeaders().getFirst("Authorization") + " body=" + body.toString("UTF-8"));
            byte[] resp = "{\"success\":true,\"data\":{\"added\":1,\"failed\":[]}}".getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, resp.length);
            ex.getResponseBody().write(resp);
            ex.close();
        });
        srv.start();
        try {
            HttpUploader up = new HttpUploader("http://127.0.0.1:" + srv.getAddress().getPort(), "icd_secrettoken", true);
            java.util.List<PreparedContact> list = new ArrayList<>();
            list.add(PreparedContact.prepare(TestSupport.contact("c1", "A", "+919845012345"), "91"));
            Batch b = Batch.plan("run12345678", "MANUAL", 1, list, new ArrayList<String>(), 0).get(0);
            UploadResult r = up.send(b);
            assertEquals(UploadResult.Kind.OK, r.kind);
            assertEquals(1, seen.size());
            assertTrue(seen.get(0).startsWith("POST /api/mobile/contacts/sync auth=Bearer icd_secrettoken body={"));
            assertTrue(seen.get(0).contains("\"idempotencyKey\":\"" + b.idempotencyKey + "\""));
        } finally {
            srv.stop(0);
        }
    }

    @Test
    public void connectionFailureIsANetworkErrorNotACrash() throws Exception {
        HttpUploader up = new HttpUploader("http://127.0.0.1:1", "icd_x", true);
        try {
            up.send(Batch.plan("run12345678", "MANUAL", 0, new ArrayList<PreparedContact>(), new ArrayList<String>(), 0).get(0));
            fail("expected NO_NETWORK");
        } catch (SyncException e) {
            assertEquals(Codes.NO_NETWORK, e.code);
        }
    }
}
