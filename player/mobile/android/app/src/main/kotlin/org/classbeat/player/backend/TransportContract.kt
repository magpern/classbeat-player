package org.classbeat.player.backend

/**
 * The one way the phone's native code reaches the backend (ADR 0011 §3 and §5), as a contract.
 * Pure: the rules every transport keeps are here, the I/O lives in the implementation.
 *
 * A transport calls only the origin fixed in the build, only the fixed paths in [Calls], sends JSON
 * with the token only in `Authorization: Bearer`, never follows a redirect, gives up after
 * [TIMEOUT_MS], reads at most the request's body cap, never sends `Sec-Fetch-Site`, never throws and
 * never logs: every failure is [HttpAnswer.Unreachable]. It answers on the main thread, later,
 * never from inside [BackendTransport.send].
 *
 * The real one is [HttpsBackendTransport] (BackendTransport.kt, #649), the only Kotlin file the network
 * guard lets reach the network; a build with no HTTPS origin wires [OfflineTransport].
 */
interface BackendTransport {
    fun send(request: BackendRequest, answer: (HttpAnswer) -> Unit)
}

enum class Method { GET, POST, DELETE }

/** One call. Its text never shows the token: a request is safe to put in a test failure. */
class BackendRequest(
    val origin: String,
    val method: Method,
    val path: String,
    /** A JSON object of text values, or null for no body. */
    val body: Map<String, String>? = null,
    val token: String? = null,
    val maxBodyBytes: Int = TransportContract.MAX_BODY_BYTES,
) {
    override fun toString(): String = "$method $path" + if (token == null) "" else " (with the device token)"
}

/** What the transport hands back: a status with its JSON body (null when none or not JSON), or nothing. */
sealed class HttpAnswer {
    data class Http(val status: Int, val body: Any?, val retryAfterS: Int?) : HttpAnswer()

    object Unreachable : HttpAnswer()
}

object TransportContract {
    const val TIMEOUT_MS = 10_000
    const val MAX_BODY_BYTES = 64 * 1024
    const val FOLLOWS_REDIRECTS = false
    private const val MAX_RETRY_AFTER_S = 3600

    /** The request's headers, in full. Nothing else is sent: no cookie, no `Sec-Fetch-Site`. */
    fun headers(request: BackendRequest): Map<String, String> {
        val out = linkedMapOf("Accept" to "application/json")
        if (request.body != null) out["Content-Type"] = "application/json"
        if (request.token != null) out["Authorization"] = "Bearer ${request.token}"
        return out
    }

    /** The body as JSON text, or null for none. */
    fun body(request: BackendRequest): String? = request.body?.let { CanonicalJson.write(it) }

    /** The address to call: the fixed origin and one of the fixed paths, or null to refuse the call. */
    fun address(request: BackendRequest, buildOrigin: String): String? {
        if (request.origin != buildOrigin || !Calls.allowed(request.method, request.path, request.token != null)) return null
        if (request.maxBodyBytes !in 1..Calls.MAX_CLASS_BYTES) return null
        return request.origin + request.path
    }

    /** `Retry-After` in whole seconds, capped at an hour; null when absent or not plain digits. */
    fun retryAfter(raw: String?): Int? {
        val text = raw?.trim() ?: return null
        if (!Regex("^[0-9]{1,5}$").matches(text)) return null
        return minOf(text.toInt(), MAX_RETRY_AFTER_S)
    }

    /** The answer's body read as JSON, or null when it is empty, too large or not JSON. */
    fun readBody(bytes: ByteArray, max: Int): Any? {
        if (bytes.isEmpty() || bytes.size > max) return null
        val text = try {
            Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } catch (e: java.nio.charset.CharacterCodingException) {
            return null
        }
        return Json.tryParse(text).getOrNull()
    }
}

/** The stand-in for a build with no HTTPS backend origin: every call is "offline". */
class OfflineTransport(private val post: (Runnable) -> Unit) : BackendTransport {
    override fun send(request: BackendRequest, answer: (HttpAnswer) -> Unit) {
        post(Runnable { answer(HttpAnswer.Unreachable) })
    }
}
