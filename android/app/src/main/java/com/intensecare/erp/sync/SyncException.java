package com.intensecare.erp.sync;

/** A sync step failed. {@code code} is one of {@link Codes} — safe to log and to send to the server (no personal data). */
public class SyncException extends Exception {
    public final String code;

    public SyncException(String code, String message) {
        super(message);
        this.code = code;
    }

    public SyncException(String code, Throwable cause) {
        super(code, cause);
        this.code = code;
    }
}
