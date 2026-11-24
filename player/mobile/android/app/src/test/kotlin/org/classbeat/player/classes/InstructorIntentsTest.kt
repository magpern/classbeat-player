package org.classbeat.player.classes

import org.classbeat.player.backend.BackendRequest
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakeClasses
import org.classbeat.player.fake.FakeClasses.change
import org.classbeat.player.fake.FakeClasses.classAnswer
import org.classbeat.player.fake.FakeClasses.doc
import org.classbeat.player.fake.FakeClasses.id
import org.classbeat.player.fake.FakeClasses.page
import org.classbeat.player.fake.FakePorts
import org.classbeat.player.fake.FakeStore
import org.classbeat.player.fake.MemoryCache
import org.classbeat.player.fake.Secrets
import org.classbeat.player.pairing.PairingRecord
import org.classbeat.player.pairing.PairingService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class InstructorIntentsTest {
    private val backend = FakeBackend()
    private val store = FakeStore(text = PairingRecord(ORIGIN, Secrets.token(), "coach@example.test").text())
    private val cache = MemoryCache()
    private val ports = object : org.classbeat.player.pairing.PairingPorts by FakePorts() {
        override fun forgetCache() = cache.clear()
    }
    private val pairing = PairingService(ORIGIN, false, "1.0.0", backend, store, ports)
    private val sync = ClassSync(backend, cache, pairing::credential, pairing::refused)
    private val intents = InstructorIntents(pairing, cache, sync)

    private val a = doc("bravo", lengthMs = 2_730_000.0, songs = 3)
    private val b = doc("Alpha")

    /** Every answer any intent gave, as the page would get it. */
    private val answers = mutableListOf<Map<String, Any?>?>()

    private fun answered(): Map<String, Any?>? = answers.last()

    private fun serve(classAnswer: (String) -> HttpAnswer = { if (it == id(1)) classAnswer(id(1), a) else classAnswer(id(2), b) }) {
        backend.route = { r: BackendRequest ->
            when {
                r.path == "/api/player/device" -> FakeBackend.device()
                r.path.contains("after=0") -> page(4, false, change(id(1), 2, a), change(id(2), 3, b))
                r.path.contains("after=") -> page(4, false)
                else -> classAnswer(r.path.substringAfterLast('/'))
            }
        }
        pairing.load()
        backend.flush()
    }

    private fun syncNow() {
        intents.syncNow { answers += it }
        backend.flush()
    }

    @Test
    fun `the list has the rows sorted by title, with minutes and songs, and the status`() {
        serve()
        syncNow()
        val list = answered()!!
        assertEquals("synced", list["status"])
        val classes = list["classes"] as List<*>
        assertEquals(listOf("Alpha", "bravo"), classes.map { (it as Map<*, *>)["title"] })
        assertEquals(mapOf("id" to id(1), "title" to "bravo", "minutes" to 46L, "songs" to 3), classes[1])
    }

    @Test
    fun `one class comes from the checked cache, an unknown id is not found, a bad id refused`() {
        serve()
        syncNow()
        intents.getClass(id(1)) { answers += it }
        assertEquals(CanonicalJson.write(a), CanonicalJson.write(answered()!!["document"]))
        intents.getClass(id(7)) { answers += it }
        assertEquals(mapOf("error" to "not_found"), answered())
        intents.getClass("../device") { answers += it }
        assertNull(answered())
    }

    @Test
    fun `an expired pairing says so and keeps the classes`() {
        serve()
        syncNow()
        backend.route = { FakeBackend.error(401, "token_expired") }
        syncNow()
        assertEquals("expired", answered()!!["status"])
        assertEquals(2, (answered()!!["classes"] as List<*>).size)
    }

    @Test
    fun `revoked on the site empties the list`() {
        serve()
        syncNow()
        backend.route = { FakeBackend.error(401, "token_revoked") }
        syncNow()
        assertEquals(emptyList<Any>(), answered()!!["classes"])
        assertNull(store.text)
    }

    @Test
    fun `offline keeps the classes and says offline`() {
        serve()
        syncNow()
        backend.route = { HttpAnswer.Unreachable }
        syncNow()
        assertEquals("offline", answered()!!["status"])
        assertEquals(2, (answered()!!["classes"] as List<*>).size)
    }

    @Test
    fun `no answer of any intent holds the token or the device code`() {
        serve()
        syncNow()
        intents.listClasses { answers += it }
        intents.getClass(id(1)) { answers += it }
        intents.getClass(id(2)) { answers += it }
        intents.getClass(id(9)) { answers += it }
        backend.route = { FakeBackend.error(401, "token_expired") }
        syncNow()
        intents.unpair()
        intents.listClasses { answers += it }
        for (answer in answers) {
            assertNotNull("an intent was refused", answer)
            val text = CanonicalJson.write(answer)
            assertFalse(text, text.contains(Secrets.token().substring(8, 20)))
            assertFalse(text, text.contains(Secrets.deviceCode().substring(7, 19)))
        }
    }

    @Test
    fun `a class that would carry the token is refused whole`() {
        // The mutation the acceptance criterion names: the token reaches one answer. Here it sits in
        // a class document the backend sent, hash and all; the answer guard refuses that answer.
        val leaky = doc(Secrets.token())
        serve { if (it == id(1)) classAnswer(id(1), leaky) else classAnswer(id(2), b) }
        backend.route = backend.route.let { r -> { q: BackendRequest -> if (q.path.contains("after=0")) page(4, false, change(id(1), 2, leaky), change(id(2), 3, b)) else r(q) } }
        syncNow()
        assertNull(answered())
        intents.getClass(id(1)) { answers += it }
        assertNull(answered())
        intents.getClass(id(2)) { answers += it }
        assertNotNull(answered())
        assertEquals(FakeClasses.hash(b), FakeClasses.hash(answered()!!["document"]))
    }
}
