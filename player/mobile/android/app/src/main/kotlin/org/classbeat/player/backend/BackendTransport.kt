package org.classbeat.player.backend

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/**
 * The real transport (#649): HTTPS to the backend origin fixed in the build, and nothing else.
 *
 * This is the one Kotlin file the network guard lets use `HttpsURLConnection` (owner, 2026-11-26;
 * ADR 0011 §8; `player/app/test/unit/rules.test.ts` pins it). It keeps [TransportContract]: it calls
 * only what [TransportContract.address] allows (the build's origin and the fixed paths in [Calls]),
 * only over HTTPS with the system's certificate checks, follows no redirect (a 3xx is
 * [HttpAnswer.Unreachable]), uses no cache, reads at most [TransportContract.MAX_BODY_BYTES] of an
 * answer and gives the whole call [TransportContract.TIMEOUT_MS]. It never throws and never logs;
 * every answer goes through [post] (the main thread), never from inside [send].
 */
class HttpsBackendTransport internal constructor(
    private val buildOrigin: String,
    private val post: (Runnable) -> Unit,
    /** Null in the app: the system's trust store. Only the loopback tests pass their own. */
    private val tls: SSLSocketFactory?,
    internal val timeoutMs: Int,
) : BackendTransport {
    constructor(buildOrigin: String, post: (Runnable) -> Unit) : this(buildOrigin, post, null, TransportContract.TIMEOUT_MS)

    override fun send(request: BackendRequest, answer: (HttpAnswer) -> Unit) {
        val address = TransportContract.address(request, buildOrigin)
        if (address == null || !address.startsWith("https://")) return reply(answer, HttpAnswer.Unreachable)
        // One deadline for the whole call: at [timeoutMs] the caller hears "unreachable", whatever
        // the connection is doing, and the call's own answer, if it comes later, is dropped.
        val once = AtomicBoolean(false)
        val finish = { a: HttpAnswer -> if (once.compareAndSet(false, true)) reply(answer, a) }
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
        try {
            val late = timer.schedule({ finish(HttpAnswer.Unreachable) }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            worker.execute {
                finish(call(request, address, deadline))
                late.cancel(false)
            }
        } catch (e: Exception) {
            finish(HttpAnswer.Unreachable)
        }
    }

    private fun reply(answer: (HttpAnswer) -> Unit, a: HttpAnswer) = post(Runnable { answer(a) })

    private fun call(request: BackendRequest, address: String, deadline: Long): HttpAnswer {
        val conn = try {
            URI(address).toURL().openConnection() as? HttpsURLConnection
        } catch (e: Exception) {
            null
        } ?: return HttpAnswer.Unreachable
        return try {
            val a = exchange(conn, request, deadline)
            if (System.nanoTime() > deadline) HttpAnswer.Unreachable else a
        } catch (e: Exception) {
            HttpAnswer.Unreachable
        } finally {
            conn.disconnect()
        }
    }

    /** Past the deadline the call stops: between reads, so a server sending slowly cannot hold it. */
    private fun inTime(deadline: Long) {
        if (System.nanoTime() > deadline) throw InterruptedIOException("past the deadline")
    }

    private fun exchange(conn: HttpsURLConnection, request: BackendRequest, deadline: Long): HttpAnswer {
        conn.instanceFollowRedirects = TransportContract.FOLLOWS_REDIRECTS
        conn.useCaches = false
        conn.allowUserInteraction = false
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        tls?.let { conn.sslSocketFactory = it }
        conn.requestMethod = request.method.name
        for ((name, value) in TransportContract.headers(request)) conn.setRequestProperty(name, value)
        val body = TransportContract.body(request)?.toByteArray(Charsets.UTF_8)
        if (body != null) {
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
        }
        val status = conn.responseCode
        inTime(deadline)
        // A redirect is not followed and is no answer from the backend; nor is anything outside HTTP's codes.
        if (status !in 200..599 || status in 300..399) return HttpAnswer.Unreachable
        // The owner's limit (2026-11-26) holds for every call, even one whose request allows more.
        val cap = minOf(request.maxBodyBytes, TransportContract.MAX_BODY_BYTES)
        val retryAfter = TransportContract.retryAfter(conn.getHeaderField("Retry-After"))
        if (conn.contentLengthLong > cap) return HttpAnswer.Http(status, null, retryAfter)
        val stream = if (status >= 400) conn.errorStream else conn.inputStream
        // Not closed here: closing may wait to drain the rest; disconnect() in [call] drops it.
        val bytes = stream?.let { readAtMost(it, cap, deadline) }
        return HttpAnswer.Http(status, bytes?.let { TransportContract.readBody(it, cap) }, retryAfter)
    }

    /** The whole stream, or null as soon as it is longer than [cap]: the rest is never read. */
    private fun readAtMost(input: InputStream, cap: Int, deadline: Long): ByteArray? {
        val out = ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (true) {
            inTime(deadline)
            val n = input.read(chunk)
            if (n < 0) return out.toByteArray()
            if (out.size() + n > cap) return null
            out.write(chunk, 0, n)
        }
    }

    private companion object {
        // Shared by every transport in the process, so re-creating the activity starts no new
        // thread: the pool's idle workers end after a minute, and the timer is one daemon thread
        // that drops a call's timeout as soon as the call has answered.
        val daemon = ThreadFactory { r -> Thread(r, "classbeat-backend").apply { isDaemon = true } }
        val worker: ExecutorService = Executors.newCachedThreadPool(daemon)
        val timer = ScheduledThreadPoolExecutor(1, daemon).apply { removeOnCancelPolicy = true }
    }
}
