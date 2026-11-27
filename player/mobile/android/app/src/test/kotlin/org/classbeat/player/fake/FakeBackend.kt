package org.classbeat.player.fake

import org.classbeat.player.backend.BackendRequest
import org.classbeat.player.backend.BackendTransport
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.backend.TransportContract
import org.classbeat.player.pairing.PairingPorts
import org.classbeat.player.pairing.SecretStore

/** A secret built at run time, so no token-shaped text sits in the sources (the CI secret scan). */
object Secrets {
    fun token(c: Char = 'A') = "cbp_" + "dev_" + c.toString().repeat(43)

    fun deviceCode(c: Char = 'B') = "cbp_" + "dc_" + c.toString().repeat(43)
}

/**
 * The fake backend every native test uses: never the network. Each call is checked against the
 * transport contract (the build's origin, a fixed path, no `Sec-Fetch-Site`) and answered later, on
 * [flush], as the real transport answers on a later main-thread turn.
 */
class FakeBackend(val origin: String = ORIGIN) : BackendTransport {
    val sent = mutableListOf<BackendRequest>()

    /** The answer given to each call in [sent], in the same order. */
    val answers = mutableListOf<HttpAnswer>()

    /** The answer to each call; unreachable unless a test says otherwise. */
    var route: (BackendRequest) -> HttpAnswer = { HttpAnswer.Unreachable }

    /**
     * Tokens the backend holds as expired. As its `device_token` dependency does, every call made
     * with one is answered 401 token_expired, before any route runs (issue #952).
     */
    var expired: Set<String> = emptySet()
    private val pending = ArrayDeque<() -> Unit>()

    override fun send(request: BackendRequest, answer: (HttpAnswer) -> Unit) {
        checkNotNull(TransportContract.address(request, origin)) { "a call the contract refuses: $request" }
        check(TransportContract.headers(request).keys.none { it.equals("Sec-Fetch-Site", ignoreCase = true) })
        sent += request
        val a = if (request.token != null && request.token in expired) TOKEN_EXPIRED else route(request)
        answers += a
        pending.addLast { answer(a) }
    }

    /** Delivers every answer due, including those of calls made while delivering. */
    fun flush() {
        while (pending.isNotEmpty()) pending.removeFirst()()
    }

    val paths get() = sent.map { "${it.method} ${it.path}" }

    companion object {
        const val ORIGIN = "https://classbeat.test"

        /** The user code every started pairing shows. */
        const val USER_CODE = "BCDF-GHJK"

        fun ok(body: Any?) = HttpAnswer.Http(200, body, null)

        val TOKEN_EXPIRED = HttpAnswer.Http(401, mapOf("error" to "token_expired"), null)

        fun status(code: Int, body: Any? = null) = HttpAnswer.Http(code, body, null)

        fun error(code: Int, error: String) = HttpAnswer.Http(code, mapOf("error" to error), null)

        fun started(origin: String = ORIGIN, code: String = Secrets.deviceCode()) = ok(
            mapOf(
                "device_code" to code,
                "user_code" to USER_CODE,
                "verification_uri" to "$origin/pair",
                "expires_in" to 600.0,
                "interval" to 5.0,
            ),
        )

        fun token(token: String = Secrets.token(), email: String? = "coach@example.test") = ok(mapOf("device_token" to token, "email" to email))

        fun device(name: String = "Pixel") = ok(mapOf("device" to mapOf("name" to name)))
    }
}

/** The Keystore store, faked: [available] false is a phone with no Keystore. */
class FakeStore(var available: Boolean = true, var saves: Boolean = true, var text: String? = null) : SecretStore {
    var deletes = 0

    /** Every text a save was asked to keep, kept or not. */
    val saved = mutableListOf<String>()

    override fun available() = available

    override fun save(text: String): Boolean {
        saved += text
        if (!saves) return false
        this.text = text
        return true
    }

    override fun load() = text

    override fun delete() {
        deletes++
        text = null
    }
}

class FakePorts(var now: Long = 1_000_000L) : PairingPorts {
    val timers = mutableListOf<Pair<Long, () -> Unit>>()
    val opened = mutableListOf<String>()
    var opens = true
    var cacheForgets = 0

    override fun now() = now

    override fun at(time: Long, run: () -> Unit) {
        timers += time to run
    }

    override fun openPage(page: String): Boolean {
        opened += page
        return opens
    }

    override fun forgetCache() {
        cacheForgets++
    }

    /** Moves the clock to the next timer and runs it. */
    fun fireNext() {
        val next = timers.minByOrNull { it.first } ?: error("no timer set")
        timers.remove(next)
        now = maxOf(now, next.first)
        next.second()
    }
}
