package org.classbeat.player.pairing

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The pairing record, encrypted under an AES-GCM key held in the Android Keystore (ADR 0011 §5).
 * The key never leaves the Keystore; only the ciphertext and its IV are in the app's private
 * preferences, which are left out of backups (allowBackup is false). There is no plain-text
 * fallback: any Keystore failure makes the store unavailable, and the app does not pair. Nothing
 * here logs, and no failure carries the text.
 */
class KeystoreSecretStore(context: Context) : SecretStore {
    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun available(): Boolean = try {
        key()
        true
    } catch (e: Exception) {
        false
    }

    override fun save(text: String): Boolean = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        val value = encode(cipher.iv) + SEPARATOR + encode(sealed)
        // commit, not apply: the pairing is kept only once it is on disk, and read back to be sure.
        prefs.edit().putString(ENTRY, value).commit() && load() == text
    } catch (e: Exception) {
        false
    }.also { kept -> if (!kept) removeEntry() }

    override fun load(): String? = try {
        val value = prefs.getString(ENTRY, null)
        val parts = value?.split(SEPARATOR)
        val key = existingKey()
        if (parts == null || parts.size != 2 || key == null) {
            null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, decode(parts[0])))
            String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8)
        }
    } catch (e: Exception) {
        null
    }

    override fun delete() {
        removeEntry()
        try {
            keyStore().deleteEntry(ALIAS)
        } catch (e: Exception) {
            // The entry is gone already; without the key it can no longer be read anyway.
        }
    }

    private fun removeEntry() {
        try {
            prefs.edit().remove(ENTRY).commit()
        } catch (e: Exception) {
            // Nothing more to do: the caller treats the store as empty.
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

    private fun key(): SecretKey {
        existingKey()?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(text: String) = Base64.decode(text, Base64.NO_WRAP)

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val ALIAS = "classbeat-pairing"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_BITS = 256
        const val TAG_BITS = 128
        const val FILE = "pairing"
        const val ENTRY = "sealed"
        const val SEPARATOR = ":"
    }
}
