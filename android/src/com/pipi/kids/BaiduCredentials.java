package com.pipi.kids;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Credentials never enter SharedPreferences, WebView, backup, or diagnostic output. */
final class BaiduCredentials {
    private static final String ALIAS = "pipikids-baidu-v1";
    private final AtomicFile file;
    BaiduCredentials(Context context) { file = new AtomicFile(new File(context.getNoBackupFilesDir(), "baidu-credentials")); }
    private SecretKey key() throws Exception {
        if (Build.VERSION.SDK_INT < 23) throw new Exception("连接网盘需要 Android 6.0 或更新版本。");
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    synchronized JSONObject read() throws Exception {
        if (!file.getBaseFile().exists()) return new JSONObject();
        try (DataInputStream input = new DataInputStream(file.openRead())) {
            int length = input.readUnsignedByte(); if (length != 12) throw new IOException();
            byte[] iv = new byte[length]; input.readFully(iv);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > 65536) throw new IOException(); bytes.write(buffer, 0, count); }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new JSONObject(new String(cipher.doFinal(bytes.toByteArray()), "UTF-8"));
        }
    }
    synchronized void write(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.toString().getBytes("UTF-8"));
        FileOutputStream output = file.startWrite();
        try { output.write(cipher.getIV().length); output.write(cipher.getIV()); output.write(encrypted); file.finishWrite(output); }
        catch (Exception error) { file.failWrite(output); throw new Exception("无法安全保存网盘授权，请重试。"); }
    }
    synchronized void clear() { file.delete(); }
}
