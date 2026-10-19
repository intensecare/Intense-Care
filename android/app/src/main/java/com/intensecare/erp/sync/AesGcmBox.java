package com.intensecare.erp.sync;

import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-256-GCM sealing: output = 12-byte random IV + ciphertext/tag. The key comes from Android Keystore on the phone. */
public class AesGcmBox implements SecretBox {
    public interface KeyProvider {
        SecretKey key() throws GeneralSecurityException;
    }

    private static final int IV_LEN = 12;
    private final KeyProvider keys;
    private final SecureRandom random = new SecureRandom();

    public AesGcmBox(KeyProvider keys) {
        this.keys = keys;
    }

    @Override
    public byte[] seal(byte[] plain) throws GeneralSecurityException {
        byte[] iv = new byte[IV_LEN];
        random.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, keys.key(), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain);
        byte[] out = new byte[IV_LEN + ct.length];
        System.arraycopy(iv, 0, out, 0, IV_LEN);
        System.arraycopy(ct, 0, out, IV_LEN, ct.length);
        return out;
    }

    @Override
    public byte[] open(byte[] sealed) throws GeneralSecurityException {
        if (sealed == null || sealed.length <= IV_LEN) throw new GeneralSecurityException("too short");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, keys.key(), new GCMParameterSpec(128, sealed, 0, IV_LEN));
        return c.doFinal(sealed, IV_LEN, sealed.length - IV_LEN);
    }
}
