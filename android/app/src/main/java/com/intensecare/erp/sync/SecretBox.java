package com.intensecare.erp.sync;

import java.security.GeneralSecurityException;

/** Encrypts small blobs for storage on the phone (the sync token and the comparison snapshot). */
public interface SecretBox {
    byte[] seal(byte[] plain) throws GeneralSecurityException;

    byte[] open(byte[] sealed) throws GeneralSecurityException;
}
