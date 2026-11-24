package org.classbeat.player.backend

import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.Secrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransportContractTest {
    private val id = "0b7a3c1e-1f2d-4e5a-8b9c-0d1e2f3a4b5c"
    private val every = listOf(
        Calls.pairingStart(ORIGIN, "1.0.0"),
        Calls.pairingToken(ORIGIN, Secrets.deviceCode()),
        Calls.device(ORIGIN, Secrets.token()),
        Calls.revoke(ORIGIN, Secrets.token()),
        Calls.changes(ORIGIN, Secrets.token(), 0),
        Calls.classDocument(ORIGIN, Secrets.token(), id),
    )

    @Test
    fun `the fixed calls are allowed, with the token on the player calls only`() {
        for (r in every) {
            assertEquals(ORIGIN + r.path, TransportContract.address(r, ORIGIN))
            assertEquals(r.path.startsWith("/api/player/"), r.token != null)
        }
    }

    @Test
    fun `no call sends Sec-Fetch-Site or a cookie, and the token only as a bearer`() {
        for (r in every) {
            val h = TransportContract.headers(r)
            assertTrue(h.keys.none { it.equals("Sec-Fetch-Site", true) || it.equals("Cookie", true) })
            assertEquals(r.token?.let { "Bearer $it" }, h["Authorization"])
            assertFalse(r.toString().contains(Secrets.token()))
            assertFalse(TransportContract.body(r)?.contains(Secrets.token()) ?: false)
        }
    }

    @Test
    fun `another origin, another path or a token on a pairing call is refused`() {
        assertNull(TransportContract.address(Calls.device("https://other.test", Secrets.token()), ORIGIN))
        assertNull(TransportContract.address(BackendRequest(ORIGIN, Method.GET, "/api/player/classes"), ORIGIN))
        assertNull(TransportContract.address(BackendRequest(ORIGIN, Method.GET, "/api/player/device"), ORIGIN))
        assertNull(TransportContract.address(BackendRequest(ORIGIN, Method.POST, "/api/pairing/start", token = Secrets.token()), ORIGIN))
        assertNull(TransportContract.address(BackendRequest(ORIGIN, Method.GET, "/api/player/changes?after=0&limit=100&x=1", token = "t"), ORIGIN))
        assertNull(TransportContract.address(Calls.device(ORIGIN, Secrets.token()).let { BackendRequest(it.origin, it.method, it.path, token = it.token, maxBodyBytes = 0) }, ORIGIN))
    }

    @Test
    fun `the limits are fixed`() {
        assertEquals(10_000, TransportContract.TIMEOUT_MS)
        assertEquals(64 * 1024, TransportContract.MAX_BODY_BYTES)
        assertFalse(TransportContract.FOLLOWS_REDIRECTS)
        assertEquals(64 * 1024, Calls.device(ORIGIN, Secrets.token()).maxBodyBytes)
        assertNull(TransportContract.readBody(ByteArray(11) { 'a'.code.toByte() }, 10))
        assertEquals(mapOf("a" to 1.0), TransportContract.readBody("{\"a\":1}".toByteArray(), 10))
        assertEquals(3600, TransportContract.retryAfter("99999"))
        assertNull(TransportContract.retryAfter("Wed, 21 Oct 2026 07:28:00 GMT"))
    }

    @Test
    fun `the offline stub answers every call as unreachable, later`() {
        val posted = mutableListOf<Runnable>()
        val answers = mutableListOf<HttpAnswer>()
        OfflineTransport { posted += it }.send(every[0]) { answers += it }
        assertTrue(answers.isEmpty())
        posted.forEach { it.run() }
        assertEquals(listOf<HttpAnswer>(HttpAnswer.Unreachable), answers)
    }
}
