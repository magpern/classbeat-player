package org.classbeat.player.pairing

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.Json
import org.classbeat.player.policy.OriginPolicy

/**
 * What the Keystore-encrypted entry holds, as text before encryption: the device token, the
 * account's email (null for an account with none) and the backend that issued the token. Pure.
 * The token is used with that backend only. Its text form never shows the token.
 */
class PairingRecord(val origin: String, val token: String, val email: String?) {
    override fun toString(): String = "PairingRecord($origin)"

    override fun equals(other: Any?): Boolean =
        other is PairingRecord && other.origin == origin && other.token == token && other.email == email

    override fun hashCode(): Int = token.hashCode()

    fun text(): String = CanonicalJson.write(mapOf("v" to 1, "origin" to origin, "token" to token, "email" to email))

    companion object {
        const val MAX_TEXT = 16 * 1024

        fun parse(text: String, allowLoopbackHttp: Boolean): PairingRecord? {
            if (text.length > MAX_TEXT) return null
            val raw = Json.tryParse(text).getOrNull() as? Map<*, *> ?: return null
            val origin = raw["origin"] as? String ?: return null
            val token = raw["token"]
            if (raw["v"] != 1.0 || OriginPolicy.parseBackendOrigin(origin, allowLoopbackHttp) != origin) return null
            if (token !is String || !PairingProtocol.isDeviceToken(token) || !raw.containsKey("email")) return null
            val email = raw["email"]?.let { PairingProtocol.shownText(it, PairingProtocol.MAX_EMAIL) ?: return null }
            return PairingRecord(origin, token, email)
        }
    }
}

/**
 * Where the record is kept: encrypted under a key in the Android Keystore, never in the clear
 * (ADR 0011 §5). Every method is synchronous and never throws.
 */
interface SecretStore {
    /** True only when a Keystore key exists or can be made. No Keystore, no pairing. */
    fun available(): Boolean

    /** Keeps the text, encrypted; false when it could not be kept (nothing half-written is left). */
    fun save(text: String): Boolean

    /** The text, or null when there is none or it cannot be decrypted. */
    fun load(): String?

    /** Deletes the entry and its key. */
    fun delete()
}
