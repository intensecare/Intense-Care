package com.intensecare.erp.sync;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

/**
 * A contact reduced to what matters for change detection: its name, its distinct usable phone numbers and
 * its emails. The hash changes exactly when one of those changes — not when Android merely touches a timestamp.
 */
public final class PreparedContact {
    public final ContactRecord source;
    public final String name;
    /** Distinct phone keys, sorted — equal numbers written differently count once. */
    public final List<String> keys;
    public final List<String> emails;
    public final String hash;

    private PreparedContact(ContactRecord source, String name, List<String> keys, List<String> emails, String hash) {
        this.source = source;
        this.name = name;
        this.keys = keys;
        this.emails = emails;
        this.hash = hash;
    }

    public String id() {
        return source.id;
    }

    /** @return null when the contact has no usable phone number (it isn't useful in the ERP directory). */
    public static PreparedContact prepare(ContactRecord c, String countryCode) {
        if (c == null || c.id == null || c.id.isEmpty() || c.id.length() > 128) return null;
        Set<String> keys = new TreeSet<>();
        for (String p : c.phones) {
            PhoneNormalizer.Result r = PhoneNormalizer.normalize(p, countryCode);
            if (r != null) keys.add(r.key);
            if (keys.size() >= 20) break;
        }
        if (keys.isEmpty()) return null;
        Set<String> emails = new LinkedHashSet<>();
        for (String e : c.emails) {
            String x = e == null ? "" : e.trim().toLowerCase(Locale.ROOT);
            if (!x.isEmpty() && x.length() <= 200 && x.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) emails.add(x);
            if (emails.size() >= 10) break;
        }
        List<String> sortedEmails = new ArrayList<>(emails);
        Collections.sort(sortedEmails);
        String name = c.name.replaceAll("\\s+", " ").trim();
        if (name.length() > 200) name = name.substring(0, 200);
        String canonical = name + "\u0001" + String.join(",", keys) + "\u0001" + String.join(",", sortedEmails);
        return new PreparedContact(c, name, new ArrayList<>(keys), sortedEmails, sha256(canonical));
    }

    public static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
