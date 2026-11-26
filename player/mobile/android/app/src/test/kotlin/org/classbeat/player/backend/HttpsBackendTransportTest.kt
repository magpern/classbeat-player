package org.classbeat.player.backend

import org.classbeat.player.fake.LoopbackHttps
import org.classbeat.player.fake.LoopbackHttps.Reply
import org.classbeat.player.fake.Secrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** The real transport against a fake backend on the loopback address only (#649). */
class HttpsBackendTransportTest {
    private val id = "0b7a3c1e-1f2d-4e5a-8b9c-0d1e2f3a4b5c"
    private val posted = LinkedBlockingQueue<Runnable>()

    private fun json(text: String) = text.toByteArray(Charsets.UTF_8)

    /** Sends [request] and waits for the answer the transport posts; the callback runs only then. */
    private fun call(t: BackendTransport, request: BackendRequest, waitS: Long = 10): HttpAnswer {
        val answers = mutableListOf<HttpAnswer>()
        t.send(request) { answers += it }
        assertTrue("never answered from inside send", answers.isEmpty())
        val r = posted.poll(waitS, TimeUnit.SECONDS) ?: throw AssertionError("no answer posted")
        r.run()
        return answers.single()
    }

    private fun transport(server: LoopbackHttps, timeoutMs: Int = TransportContract.TIMEOUT_MS) =
        HttpsBackendTransport(server.origin, { posted += it }, server.trusting, timeoutMs)

    @Test
    fun `a pairing call sends its JSON body with the fixed headers and no token`() {
        LoopbackHttps { Reply(200, json("{\"device_code\":\"x\"}")) }.use { s ->
            val a = call(transport(s), Calls.pairingStart(s.origin, "1.2.3"))
            assertEquals(HttpAnswer.Http(200, mapOf("device_code" to "x"), null), a)
            val r = s.received.single()
            assertEquals("POST", r.method)
            assertEquals("/api/pairing/start", r.target)
            assertEquals("{\"platform\":\"android\",\"version\":\"1.2.3\"}", r.body)
            assertEquals("application/json", r.headers["accept"])
            assertEquals("application/json", r.headers["content-type"])
            for (h in listOf("authorization", "cookie", "sec-fetch-site")) assertNull(h, r.headers[h])
        }
    }

    @Test
    fun `a player call sends the token only as a bearer, and an error answer keeps its body and Retry-After`() {
        LoopbackHttps { Reply(429, json("{\"error\":\"rate_limited\"}"), mapOf("Retry-After" to "120")) }.use { s ->
            val a = call(transport(s), Calls.device(s.origin, Secrets.token()))
            assertEquals(HttpAnswer.Http(429, mapOf("error" to "rate_limited"), 120), a)
            val r = s.received.single()
            assertEquals("GET", r.method)
            assertEquals("/api/player/device", r.target)
            assertEquals("Bearer ${Secrets.token()}", r.headers["authorization"])
            assertEquals("", r.body)
            assertNull(r.headers["cookie"])
            assertNull(r.headers["sec-fetch-site"])
        }
    }

    @Test
    fun `a revoke is a DELETE, and an answer that is not JSON has no body`() {
        LoopbackHttps { Reply(204) }.use { s ->
            assertEquals(HttpAnswer.Http(204, null, null), call(transport(s), Calls.revoke(s.origin, Secrets.token())))
            assertEquals("DELETE", s.received.single().method)
        }
        LoopbackHttps { Reply(200, json("<html>")) }.use { s ->
            assertEquals(HttpAnswer.Http(200, null, null), call(transport(s), Calls.device(s.origin, Secrets.token())))
        }
    }

    @Test
    fun `a redirect is never followed`() {
        LoopbackHttps { Reply(302, headers = mapOf("Location" to "/api/player/device")) }.use { s ->
            assertEquals(HttpAnswer.Unreachable, call(transport(s), Calls.device(s.origin, Secrets.token())))
            assertEquals(1, s.received.size)
        }
    }

    @Test
    fun `an answer over 64 KiB is not read, on every call, even one whose request allows more`() {
        val cap = 64 * 1024
        val exactly = json("\"" + "a".repeat(cap - 2) + "\"")
        val over = json("\"" + "a".repeat(cap - 1) + "\"")
        LoopbackHttps { Reply(200, exactly) }.use { s ->
            val a = call(transport(s), Calls.device(s.origin, Secrets.token())) as HttpAnswer.Http
            assertEquals("a".repeat(cap - 2), a.body)
        }
        for (request in listOf<(String) -> BackendRequest>(
            { Calls.device(it, Secrets.token()) },
            { Calls.changes(it, Secrets.token(), 0) },
            { Calls.classDocument(it, Secrets.token(), id) },
        )) {
            // Announced by its length, and not announced: read up to the limit, then dropped.
            for (length in listOf(true, false)) {
                LoopbackHttps { Reply(200, over, length = length) }.use { s ->
                    assertEquals(HttpAnswer.Http(200, null, null), call(transport(s), request(s.origin)))
                }
            }
        }
    }

    @Test
    fun `a server that stalls is given up at the deadline`() {
        LoopbackHttps { Reply(200, json("{}"), stallMs = 5_000) }.use { s ->
            val started = System.nanoTime()
            assertEquals(HttpAnswer.Unreachable, call(transport(s, timeoutMs = 300), Calls.device(s.origin, Secrets.token())))
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 4_000)
        }
    }

    @Test
    fun `a server that sends slowly is given up at the deadline for the whole call`() {
        // Each byte comes well inside the read timeout; only the call's own deadline stops it.
        LoopbackHttps { Reply(200, json("\"" + "a".repeat(100) + "\""), dripMs = 100) }.use { s ->
            val started = System.nanoTime()
            assertEquals(HttpAnswer.Unreachable, call(transport(s, timeoutMs = 600), Calls.device(s.origin, Secrets.token())))
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 4_000)
        }
    }

    @Test
    fun `the app's transport uses the fixed timeout`() {
        assertEquals(10_000, HttpsBackendTransport("https://classbeat.test") {}.timeoutMs)
    }

    @Test
    fun `another origin, another path, plain HTTP or an untrusted certificate never sends the call`() {
        LoopbackHttps { Reply(200, json("{}")) }.use { s ->
            val t = transport(s)
            assertEquals(HttpAnswer.Unreachable, call(t, Calls.device("https://other.test", Secrets.token())))
            assertEquals(HttpAnswer.Unreachable, call(t, BackendRequest(s.origin, Method.GET, "/api/player/classes", token = Secrets.token())))
            assertEquals(HttpAnswer.Unreachable, call(t, BackendRequest(s.origin, Method.POST, "/api/pairing/start", mapOf("a" to "b"), Secrets.token())))
            val plain = s.origin.replace("https://", "http://")
            assertEquals(HttpAnswer.Unreachable, call(HttpsBackendTransport(plain, { posted += it }, s.trusting, 1000), Calls.device(plain, Secrets.token())))
            assertEquals(0, s.connections.get())
            // The system's trust store does not know this run's certificate: the handshake fails.
            val system = HttpsBackendTransport(s.origin, { posted += it }, null, 5_000)
            assertEquals(HttpAnswer.Unreachable, call(system, Calls.device(s.origin, Secrets.token())))
            assertTrue(s.received.isEmpty())
        }
    }

    @Test
    fun `nothing listening is unreachable`() {
        val origin = LoopbackHttps { Reply(200) }.use { it.origin }
        val t = HttpsBackendTransport(origin, { posted += it }, null, 2_000)
        assertEquals(HttpAnswer.Unreachable, call(t, Calls.device(origin, Secrets.token())))
    }
}
