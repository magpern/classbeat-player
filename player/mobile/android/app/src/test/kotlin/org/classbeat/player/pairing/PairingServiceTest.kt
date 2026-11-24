package org.classbeat.player.pairing

import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.backend.OfflineTransport
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakePorts
import org.classbeat.player.fake.FakeStore
import org.classbeat.player.fake.Secrets
import org.classbeat.player.mode.ScreenLine
import org.classbeat.player.pairing.PairingMachine.Notice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingServiceTest {
    private val backend = FakeBackend()
    private val store = FakeStore()
    private val ports = FakePorts()
    private var forgotten = 0

    private fun service(origin: String? = ORIGIN, transport: org.classbeat.player.backend.BackendTransport = backend) =
        PairingService(origin, false, "1.0.0", transport, store, ports).also { it.forgotten = { forgotten++ } }

    /** Pairs through the fake backend: start, the page, one poll, the token. */
    private fun paired(s: PairingService = service()): PairingService {
        backend.route = { r ->
            when (r.path) {
                "/api/pairing/start" -> FakeBackend.started()
                "/api/pairing/token" -> FakeBackend.token()
                else -> FakeBackend.device()
            }
        }
        s.load()
        s.begin()
        backend.flush()
        ports.fireNext()
        backend.flush()
        assertTrue(s.view() is PairingView.Paired)
        return s
    }

    @Test
    fun `pairs, opens the page in the browser and keeps the token in the store`() {
        val s = paired()
        assertEquals(listOf("$ORIGIN/pair"), ports.opened)
        assertEquals(Secrets.token(), PairingRecord.parse(store.text!!, false)!!.token)
        assertEquals(Secrets.token(), s.credential()!!.token)
        assertEquals(PairingView.Paired("coach@example.test", null, false, null), s.view())
        assertFalse(s.view().toString().contains(Secrets.token()))
        assertEquals(listOf(Secrets.token()), s.secrets())
        // The pairing calls carry no token; the start carries the platform and the version only.
        assertTrue(backend.sent.all { it.token == null })
        assertEquals(mapOf("platform" to "android", "version" to "1.0.0"), backend.sent[0].body)
    }

    @Test
    fun `the view never holds the device code or the token`() {
        val s = service()
        backend.route = { r -> if (r.path == "/api/pairing/start") FakeBackend.started() else FakeBackend.error(400, "authorization_pending") }
        s.load()
        s.begin()
        backend.flush()
        val waiting = s.view() as PairingView.Waiting
        assertEquals("BCDF-GHJK", waiting.userCode)
        assertFalse(waiting.toString().contains(Secrets.deviceCode()))
        assertEquals(listOf(Secrets.deviceCode()), s.secrets())
    }

    @Test
    fun `no Keystore means no pairing and no call`() {
        store.available = false
        val s = service()
        s.load()
        s.begin()
        assertEquals(PairingView.Unpaired(Notice.NO_KEYSTORE), s.view())
        assertTrue(backend.sent.isEmpty())
        assertNull(store.text)
    }

    @Test
    fun `a build with no backend cannot pair`() {
        val s = service(origin = null)
        s.load()
        s.begin()
        assertEquals(PairingView.Unpaired(Notice.NO_SERVER), s.view())
        assertTrue(backend.sent.isEmpty())
    }

    @Test
    fun `the offline stub shows the server could not be reached`() {
        val posted = mutableListOf<Runnable>()
        val s = service(transport = OfflineTransport { posted += it })
        s.load()
        s.begin()
        assertEquals(PairingView.Starting, s.view())
        posted.forEach { it.run() }
        assertEquals(PairingView.Unpaired(Notice.UNREACHABLE), s.view())
    }

    @Test
    fun `a token that cannot be kept is given back and nothing is left`() {
        store.saves = false
        val s = service()
        backend.route = { r -> if (r.path == "/api/pairing/start") FakeBackend.started() else FakeBackend.token() }
        s.load()
        s.begin()
        backend.flush()
        ports.fireNext()
        backend.flush()
        assertEquals(PairingView.Unpaired(Notice.SAVE_FAILED), s.view())
        assertNull(s.credential())
        assertTrue("DELETE /api/player/device" in backend.paths)
        assertEquals(1, ports.cacheForgets)
    }

    @Test
    fun `revoked or unknown on the site deletes the token and the cache`() {
        for (code in listOf("token_revoked", "token_unknown")) {
            val store = FakeStore(text = PairingRecord(ORIGIN, Secrets.token(), null).text())
            val ports = FakePorts()
            val backend = FakeBackend().apply { route = { FakeBackend.error(401, code) } }
            val s = PairingService(ORIGIN, false, "1.0.0", backend, store, ports)
            var gone = 0
            s.forgotten = { gone++ }
            s.load()
            backend.flush()
            assertEquals(code, PairingView.Unpaired(Notice.REVOKED_ON_SITE), s.view())
            assertNull(store.text)
            assertEquals(1, ports.cacheForgets)
            assertEquals(1, gone)
        }
    }

    @Test
    fun `the revoked plate is held when the pairing screen opens, and only Start again begins`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), null).text()
        backend.route = { r -> if (r.path == "/api/player/device") FakeBackend.error(401, "token_revoked") else FakeBackend.started() }
        val s = service()
        s.load()
        backend.flush()
        // What PairingUi.open reads: no begin, and the plate with "Start again" first.
        val view = s.view()
        assertFalse(PairingScreenModel.begins(view))
        val plate = PairingScreenModel.screen(view, 0, true, false, false)
        assertTrue(plate.lines.any { it is ScreenLine.Plate && it.head == "Unpaired on the website." })
        assertEquals(PairingScreenModel.Action.START_AGAIN, plate.keys.first { it.main }.action)
        assertTrue(backend.sent.none { it.path == "/api/pairing/start" })
        // "Start again" begins.
        s.begin()
        backend.flush()
        assertTrue(s.view() is PairingView.Waiting)
    }

    @Test
    fun `a plate seen and left is not shown again`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), null).text()
        backend.route = { FakeBackend.error(401, "token_revoked") }
        val s = service()
        s.load()
        backend.flush()
        s.cancel()
        s.seen()
        assertEquals(PairingView.Unpaired(null), s.view())
        assertTrue(PairingScreenModel.begins(s.view()))
        assertTrue(PairingScreenModel.begins(PairingView.Unpaired(Notice.UNPAIRED)))
    }

    @Test
    fun `a pair again holds the expired token as a secret too`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), null).text()
        backend.route = { r -> if (r.path == "/api/player/device") FakeBackend.error(401, "token_expired") else FakeBackend.started() }
        val s = service()
        s.load()
        backend.flush()
        s.begin()
        assertEquals(listOf(Secrets.token()), s.secrets())
        backend.flush()
        assertTrue(s.view() is PairingView.Waiting)
        assertEquals(listOf(Secrets.deviceCode(), Secrets.token()), s.secrets())
    }

    @Test
    fun `an expired token keeps the cache and asks to pair again`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), "coach@example.test").text()
        backend.route = { FakeBackend.error(401, "token_expired") }
        val s = service()
        s.load()
        backend.flush()
        assertEquals(PairingView.Paired("coach@example.test", null, true, null), s.view())
        assertTrue(s.paired())
        assertNull(s.credential())
        assertNotNull(store.text)
        assertEquals(0, ports.cacheForgets)
        assertEquals(0, forgotten)
    }

    @Test
    fun `a pair again that is cancelled returns to the expired pairing`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), "coach@example.test").text()
        backend.route = { r -> if (r.path == "/api/player/device") FakeBackend.error(401, "token_expired") else FakeBackend.started() }
        val s = service()
        s.load()
        backend.flush()
        s.begin()
        backend.flush()
        assertTrue(s.view() is PairingView.Waiting)
        s.cancel()
        assertEquals(PairingView.Paired("coach@example.test", null, true, null), s.view())
        assertNotNull(store.text)
        assertEquals(0, forgotten)
    }

    @Test
    fun `a pair again that fails says why and keeps the expired pairing`() {
        store.text = PairingRecord(ORIGIN, Secrets.token(), null).text()
        backend.route = { r -> if (r.path == "/api/player/device") FakeBackend.error(401, "token_expired") else FakeBackend.error(429, "too_many") }
        val s = service()
        s.load()
        backend.flush()
        s.begin()
        backend.flush()
        assertEquals(PairingView.Paired(null, null, true, Notice.TOO_MANY), s.view())
    }

    @Test
    fun `a sync refusal ends or pauses the pairing`() {
        val s = paired()
        s.refused(PairingProtocol.Refusal.EXPIRED)
        assertNull(s.credential())
        assertNotNull(store.text)
        s.refused(PairingProtocol.Refusal.GONE)
        assertEquals(PairingView.Unpaired(Notice.REVOKED_ON_SITE), s.view())
        assertNull(store.text)
        assertEquals(1, forgotten)
    }

    @Test
    fun `unpair deletes here first and gives the token back, offline too`() {
        val s = paired()
        backend.route = { HttpAnswer.Unreachable }
        s.unpair()
        assertNull(store.text)
        assertEquals(1, ports.cacheForgets)
        assertEquals(1, forgotten)
        assertEquals(PairingView.Unpaired(Notice.UNPAIRED), s.view())
        val revoke = backend.sent.last()
        assertEquals("DELETE /api/player/device", "${revoke.method} ${revoke.path}")
        assertEquals(Secrets.token(), revoke.token)
        backend.flush()
        assertEquals(PairingView.Unpaired(Notice.UNPAIRED), s.view())
    }

    @Test
    fun `cancel never ends a pairing held`() {
        val s = paired()
        s.cancel()
        assertTrue(s.view() is PairingView.Paired)
        assertNotNull(store.text)
    }

    @Test
    fun `a stored pairing for another backend or unreadable is deleted, never used`() {
        for (text in listOf(PairingRecord("https://other.test", Secrets.token(), null).text(), "{not json")) {
            val store = FakeStore(text = text)
            val ports = FakePorts()
            val s = PairingService(ORIGIN, false, "1.0.0", backend, store, ports)
            s.load()
            assertNull(store.text)
            assertEquals(1, ports.cacheForgets)
            assertEquals(PairingView.Unpaired(null), s.view())
        }
        assertTrue(backend.sent.isEmpty())
    }
}
