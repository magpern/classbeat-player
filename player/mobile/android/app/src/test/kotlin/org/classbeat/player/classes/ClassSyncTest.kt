package org.classbeat.player.classes

import org.classbeat.player.backend.BackendRequest
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.classes.ClassSync.Outcome
import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakeClasses
import org.classbeat.player.fake.FakeClasses.change
import org.classbeat.player.fake.FakeClasses.classAnswer
import org.classbeat.player.fake.FakeClasses.doc
import org.classbeat.player.fake.FakeClasses.id
import org.classbeat.player.fake.FakeClasses.page
import org.classbeat.player.fake.MemoryCache
import org.classbeat.player.fake.Secrets
import org.classbeat.player.pairing.PairingProtocol
import org.classbeat.player.pairing.PairingRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassSyncTest {
    private val backend = FakeBackend()
    private val cache = MemoryCache()
    private var record: PairingRecord? = PairingRecord(ORIGIN, Secrets.token(), null)
    private val refusals = mutableListOf<PairingProtocol.Refusal>()
    private val sync = ClassSync(backend, cache, { record }, { refusals += it })

    private val a = doc("Alpha")
    private val b = doc("Bravo")

    /** Answers by path: the changes after a cursor, and each class. */
    private fun serve(pages: Map<Long, HttpAnswer>, classes: Map<String, HttpAnswer> = emptyMap()) {
        backend.route = { r: BackendRequest ->
            val after = Regex("after=(\\d+)").find(r.path)?.groupValues?.get(1)?.toLong()
            if (after != null) pages.getValue(after) else classes.getValue(r.path.substringAfterLast('/'))
        }
    }

    private fun run(): Outcome {
        var out: Outcome? = null
        sync.run { out = it }
        backend.flush()
        return out!!
    }

    @Test
    fun `fetches new classes page by page and moves the cursor after each`() {
        serve(
            mapOf(0L to page(5, true, change(id(1), 3, a)), 5L to page(9, false, change(id(2), 7, b))),
            mapOf(id(1) to classAnswer(id(1), a), id(2) to classAnswer(id(2), b)),
        )
        assertEquals(Outcome.UP_TO_DATE, run())
        assertEquals(9L, cache.position)
        assertEquals(CanonicalJson.write(a), cache.document(id(1)))
        assertEquals(setOf(id(1), id(2)), cache.held().keys)
        assertTrue(backend.sent.all { it.token == Secrets.token() })
    }

    @Test
    fun `a class whose hash is unchanged is not fetched, a removal removes`() {
        cache.put(id(1), FakeClasses.hash(a), CanonicalJson.write(a))
        cache.put(id(2), FakeClasses.hash(b), CanonicalJson.write(b))
        serve(mapOf(0L to page(4, false, change(id(1), 2, a), change(id(2), 3))))
        assertEquals(Outcome.UP_TO_DATE, run())
        assertEquals(setOf(id(1)), cache.held().keys)
        assertEquals(1, backend.sent.size)
    }

    @Test
    fun `a class whose content does not match its hash never reaches the cache`() {
        serve(mapOf(0L to page(4, false, change(id(1), 2, a))), mapOf(id(1) to classAnswer(id(1), b, FakeClasses.hash(a))))
        assertEquals(Outcome.UP_TO_DATE, run())
        assertTrue(cache.docs.isEmpty())
    }

    @Test
    fun `revoked forgets through the pairing, expired keeps the cache`() {
        cache.put(id(1), FakeClasses.hash(a), CanonicalJson.write(a))
        serve(mapOf(0L to FakeBackend.error(401, "token_expired")))
        assertEquals(Outcome.EXPIRED, run())
        assertEquals(listOf(PairingProtocol.Refusal.EXPIRED), refusals)
        assertEquals(1, cache.docs.size)
        serve(mapOf(0L to FakeBackend.error(401, "token_revoked")))
        assertEquals(Outcome.GONE, run())
        assertEquals(PairingProtocol.Refusal.GONE, refusals.last())
    }

    @Test
    fun `offline and server faults change nothing`() {
        serve(mapOf(0L to HttpAnswer.Unreachable))
        assertEquals(Outcome.OFFLINE, run())
        serve(mapOf(0L to FakeBackend.status(503)))
        assertEquals(Outcome.RETRY, run())
        assertTrue(refusals.isEmpty())
        assertEquals(0L, cache.position)
    }

    @Test
    fun `a resync walks from the start and then removes what it did not see`() {
        cache.put(id(9), FakeClasses.hash(b), CanonicalJson.write(b))
        cache.position = 50
        serve(
            mapOf(
                50L to HttpAnswer.Http(409, mapOf("error" to "resync_required", "cursor" to 0.0), null),
                0L to page(3, true, change(id(1), 2, a)),
                3L to page(6, false),
            ),
            mapOf(id(1) to classAnswer(id(1), a)),
        )
        assertEquals(Outcome.UP_TO_DATE, run())
        assertEquals(setOf(id(1)), cache.held().keys)
        assertEquals(6L, cache.position)
    }

    @Test
    fun `unpaired during a sync writes nothing more`() {
        serve(mapOf(0L to page(4, false, change(id(1), 2, a))), mapOf(id(1) to classAnswer(id(1), a)))
        var out: Outcome? = null
        sync.run { out = it }
        record = null
        backend.flush()
        assertEquals(Outcome.NOT_PAIRED, out)
        assertTrue(cache.docs.isEmpty())
        assertEquals(0L, cache.position)
    }

    @Test
    fun `a second caller joins the running sync, and a full disk is storage`() {
        serve(mapOf(0L to page(4, false, change(id(1), 2, a))), mapOf(id(1) to classAnswer(id(1), a)))
        cache.fails = true
        val outs = mutableListOf<Outcome>()
        sync.run { outs += it }
        sync.run { outs += it }
        backend.flush()
        assertEquals(listOf(Outcome.STORAGE, Outcome.STORAGE), outs)
        assertEquals(2, backend.sent.size)
    }

    @Test
    fun `no credential, no call`() {
        record = null
        assertEquals(Outcome.NOT_PAIRED, run())
        assertTrue(backend.sent.isEmpty())
    }
}
