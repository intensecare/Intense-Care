package com.intensecare.erp.sync.android;

import com.intensecare.erp.sync.Codes;
import com.intensecare.erp.sync.SyncEngine;
import com.intensecare.erp.sync.SyncException;
import com.intensecare.erp.sync.ContactRecord;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the phone's address book. Read-only: nothing is ever written back to the phone.
 * The contact id is Android's CONTACT_ID ("c" + id): stable across edits and renames. Merging two contacts on the phone
 * changes it, which shows up in the ERP as one removed + one updated contact — never as a duplicate customer.
 */
public final class AndroidContactSource implements SyncEngine.Source {
    private final Context ctx;

    public AndroidContactSource(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    public static boolean hasPermission(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Contacts that have at least one phone number — the cheap count shown on the Contact Sync screen. */
    public int countWithPhone() {
        if (!hasPermission(ctx)) return -1;
        try (Cursor c = ctx.getContentResolver().query(ContactsContract.Contacts.CONTENT_URI, new String[] {ContactsContract.Contacts._ID}, ContactsContract.Contacts.HAS_PHONE_NUMBER + "=1", null, null)) {
            return c == null ? -1 : c.getCount();
        } catch (RuntimeException e) {
            return -1;
        }
    }

    @Override
    public List<ContactRecord> readAll() throws SyncException {
        if (!hasPermission(ctx)) throw new SyncException(Codes.PERMISSION_DENIED, "READ_CONTACTS not granted");
        ContentResolver cr = ctx.getContentResolver();
        Map<Long, ContactRecord> byId = new LinkedHashMap<>();
        try {
            String[] phoneCols = {
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.CONTACT_LAST_UPDATED_TIMESTAMP,
            };
            try (Cursor c = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, phoneCols, null, null, ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " ASC")) {
                if (c == null) throw new SyncException(Codes.READ_FAILED, "no cursor");
                while (c.moveToNext()) {
                    long id = c.getLong(0);
                    ContactRecord rec = byId.get(id);
                    if (rec == null) {
                        rec = new ContactRecord("c" + id, c.getString(1), c.getLong(3));
                        byId.put(id, rec);
                    }
                    String number = c.getString(2);
                    if (number != null && rec.phones.size() < 50) rec.phones.add(number);
                }
            }
            String[] mailCols = {ContactsContract.CommonDataKinds.Email.CONTACT_ID, ContactsContract.CommonDataKinds.Email.ADDRESS};
            try (Cursor c = cr.query(ContactsContract.CommonDataKinds.Email.CONTENT_URI, mailCols, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        ContactRecord rec = byId.get(c.getLong(0));
                        String addr = c.getString(1);
                        if (rec != null && addr != null && rec.emails.size() < 20) rec.emails.add(addr);
                    }
                }
            }
        } catch (SecurityException e) {
            throw new SyncException(Codes.PERMISSION_DENIED, e);
        } catch (SyncException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new SyncException(Codes.READ_FAILED, e);
        }
        return new ArrayList<>(byId.values());
    }
}
