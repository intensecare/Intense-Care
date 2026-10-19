package com.intensecare.erp.sync;

import java.util.ArrayList;
import java.util.List;

/** One contact as read from the phone. Only these fields ever leave the device. */
public final class ContactRecord {
    public final String id;
    public final String name;
    public final List<String> phones = new ArrayList<>();
    public final List<String> emails = new ArrayList<>();
    public final long updatedAt;

    public ContactRecord(String id, String name, long updatedAt) {
        this.id = id;
        this.name = name == null ? "" : name;
        this.updatedAt = updatedAt;
    }
}
