package com.intensecare.erp.sync;

import java.util.regex.Pattern;

/**
 * Phone-number normalisation — a line-for-line mirror of src/lib/phone.ts. Both are run against the same
 * vectors (tests/fixtures/phone-vectors.json), so the phone and the server always agree on what a number is.
 *
 *   e164  "+" and digits, the international form
 *   key   the LAST 10 digits — what customers, leads and contacts are matched on
 */
public final class PhoneNormalizer {
    public static final class Result {
        public final String e164;
        public final String key;

        Result(String e164, String key) {
            this.e164 = e164;
            this.key = key;
        }
    }

    private static final Pattern TEL = Pattern.compile("^tel:", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXT = Pattern.compile("\\s*(ext\\.?|extension|x)\\s*\\d+\\s*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern JUNK = Pattern.compile("[*#A-Za-z]");
    private static final Pattern NON_DIGIT = Pattern.compile("[^0-9]");
    private static final Pattern ONE_DIGIT = Pattern.compile("^(\\d)\\1+$");

    private PhoneNormalizer() {}

    /** @return the normalised number, or null when the text can't be a real phone number. */
    public static Result normalize(String raw, String countryCode) {
        if (raw == null) return null;
        String t = raw.trim();
        if (t.isEmpty() || t.length() > 40) return null;
        t = TEL.matcher(t).replaceFirst("");
        t = EXT.matcher(t).replaceFirst("");
        if (JUNK.matcher(t).find()) return null;
        boolean plus = t.startsWith("+");
        String d = NON_DIGIT.matcher(t).replaceAll("");
        if (d.length() < 7) return null;
        if (!plus) {
            if (d.startsWith("00")) d = d.substring(2);
            else if (d.length() == 11 && d.startsWith("0")) d = countryCode + d.substring(1);
            else if (d.length() == 10) d = countryCode + d;
        }
        if (d.length() < 8 || d.length() > 15) return null;
        String key = d.substring(d.length() - 10);
        if (ONE_DIGIT.matcher(key).matches()) return null;
        return new Result("+" + d, key);
    }
}
