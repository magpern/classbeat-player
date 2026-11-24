package org.classbeat.player.pairing

import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.policy.OriginPolicy

/**
 * What the backend answers to the pairing calls (ADR 0002 §2 and §6), read strictly, as the
 * desktop's `core/pairing/protocol.ts` reads it. Pure. Anything not exactly an expected answer is
 * "unexpected": the app never guesses.
 */
object PairingProtocol {
    private const val SECRET = "[A-Za-z0-9_-]{43}"
    private val DEVICE_CODE = Regex("^cbp_dc_$SECRET$")
    private val DEVICE_TOKEN = Regex("^cbp_dev_$SECRET$")
    private val USER_CODE = Regex("^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$")
    private val HIDDEN = Regex("[\\p{C}\\u2028\\u2029]")

    const val MIN_INTERVAL_S = 5
    private const val MAX_INTERVAL_S = 60
    private const val MAX_EXPIRES_S = 3600
    const val MAX_EMAIL = 320
    const val MAX_LABEL = 40

    fun isDeviceToken(v: Any?): Boolean = v is String && DEVICE_TOKEN.matches(v)

    fun field(body: Any?, key: String): Any? = (body as? Map<*, *>)?.get(key)

    private fun wholeNumber(v: Any?, min: Int, max: Int): Int? {
        val d = v as? Double ?: return null
        return if (d == Math.floor(d) && d >= min && d <= max) d.toInt() else null
    }

    /** Text from the server a person will read: no control or format characters, 1 to [max] long. */
    fun shownText(v: Any?, max: Int): String? {
        if (v !is String || v.length > 10 * max) return null
        val kept = HIDDEN.replace(v, "").trim()
        return if (kept.length in 1..max) kept else null
    }

    sealed class Start {
        data class Started(val deviceCode: String, val userCode: String, val page: String, val expiresInMs: Long, val intervalMs: Long) : Start() {
            override fun toString() = "Started($userCode)"
        }

        object TooMany : Start()

        object Unreachable : Start()

        object Unexpected : Start()
    }

    fun parseStart(a: HttpAnswer, origin: String): Start {
        if (a !is HttpAnswer.Http) return Start.Unreachable
        if (a.status == 429) return Start.TooMany
        if (a.status >= 500) return Start.Unreachable
        if (a.status != 200) return Start.Unexpected
        val deviceCode = field(a.body, "device_code")
        val userCode = field(a.body, "user_code")
        val page = OriginPolicy.pairingPageOn(origin, field(a.body, "verification_uri"))
        val expires = wholeNumber(field(a.body, "expires_in"), 1, MAX_EXPIRES_S)
        val interval = wholeNumber(field(a.body, "interval"), 1, MAX_INTERVAL_S)
        if (deviceCode !is String || !DEVICE_CODE.matches(deviceCode)) return Start.Unexpected
        if (userCode !is String || !USER_CODE.matches(userCode)) return Start.Unexpected
        if (page == null || expires == null || interval == null) return Start.Unexpected
        // Never faster than the 5 s the protocol allows, whatever the answer says.
        return Start.Started(deviceCode, userCode, page, expires * 1000L, maxOf(interval, MIN_INTERVAL_S) * 1000L)
    }

    sealed class Poll {
        class Ok(val token: String, val email: String?) : Poll() {
            override fun toString() = "Ok"
        }

        data class Refused(val code: String) : Poll()

        /** No answer, a server fault or a rate limit: ask again later. */
        data class Retry(val afterMs: Long?) : Poll()

        object Unexpected : Poll()
    }

    const val PENDING = "authorization_pending"
    const val SLOW_DOWN = "slow_down"
    const val DENIED = "access_denied"
    const val EXPIRED = "expired_token"
    private val REFUSALS = setOf(PENDING, SLOW_DOWN, DENIED, EXPIRED)

    fun parsePoll(a: HttpAnswer): Poll {
        if (a !is HttpAnswer.Http) return Poll.Retry(null)
        if (a.status == 429 || a.status >= 500) return Poll.Retry(a.retryAfterS?.let { it * 1000L })
        if (a.status == 400) {
            val code = field(a.body, "error")
            return if (code is String && code in REFUSALS) Poll.Refused(code) else Poll.Unexpected
        }
        if (a.status != 200) return Poll.Unexpected
        val token = field(a.body, "device_token")
        val body = a.body as? Map<*, *> ?: return Poll.Unexpected
        if (!body.containsKey("email")) return Poll.Unexpected
        val raw = body["email"]
        val email = if (raw == null) null else shownText(raw, MAX_EMAIL) ?: return Poll.Unexpected
        return if (token is String && isDeviceToken(token)) Poll.Ok(token, email) else Poll.Unexpected
    }

    enum class Refusal { GONE, EXPIRED }

    /** A 401 that says the token is gone for good or ran out; null for any other answer. */
    fun tokenRefusal(a: HttpAnswer): Refusal? {
        if (a !is HttpAnswer.Http || a.status != 401) return null
        return when (field(a.body, "error")) {
            "token_revoked", "token_unknown" -> Refusal.GONE
            "token_expired" -> Refusal.EXPIRED
            else -> null
        }
    }

    sealed class Device {
        data class Ok(val name: String) : Device()

        object Gone : Device()

        object Expired : Device()

        object Unknown : Device()
    }

    fun parseDevice(a: HttpAnswer): Device {
        when (tokenRefusal(a)) {
            Refusal.GONE -> return Device.Gone
            Refusal.EXPIRED -> return Device.Expired
            null -> Unit
        }
        if (a !is HttpAnswer.Http || a.status != 200) return Device.Unknown
        val name = shownText(field(field(a.body, "device"), "name"), MAX_LABEL)
        return if (name == null) Device.Unknown else Device.Ok(name)
    }
}
