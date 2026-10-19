package com.intensecare.erp.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The phone and the server must agree on every number: both run tests/fixtures/phone-vectors.json. */
public class PhoneNormalizerTest {
    @Test
    public void matchesTheSharedVectors() throws Exception {
        File f = new File("../../tests/fixtures/phone-vectors.json");
        assertTrue("fixture not found at " + f.getAbsolutePath(), f.exists());
        JSONObject root = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
        String cc = root.getString("defaultCountryCode");
        JSONArray cases = root.getJSONArray("cases");
        assertTrue(cases.length() >= 15);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            PhoneNormalizer.Result r = PhoneNormalizer.normalize(c.getString("raw"), cc);
            if (c.isNull("e164")) {
                assertNull("expected no number for '" + c.getString("raw") + "'", r);
            } else {
                assertNotNull("expected a number for '" + c.getString("raw") + "'", r);
                assertEquals(c.getString("raw"), c.getString("e164"), r.e164);
                assertEquals(c.getString("raw"), c.getString("key"), r.key);
            }
        }
    }

    @Test
    public void nullIsNotANumber() {
        assertNull(PhoneNormalizer.normalize(null, "91"));
    }
}
