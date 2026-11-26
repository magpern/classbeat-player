package org.classbeat.player.follow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The follower with a fake source and fake listener access (issue #632): no phone, no music app. */
class FollowerTest {
    private class FakeAccess(var grant: Boolean = false, var opens: Boolean = true) : ListenerAccess {
        val switches = mutableListOf<Boolean>()
        var opened = 0

        override fun granted() = grant

        override fun enable(on: Boolean) {
            switches += on
        }

        override fun openSetting(): Boolean {
            opened++
            return opens
        }
    }

    private class FakeSource(var status: SourceStatus = SourceStatus.NOTHING, var reading: SourceReading? = null) : MusicSource {
        val calls = mutableListOf<String>()

        override fun start() {
            calls += "start"
        }

        override fun stop() {
            calls += "stop"
        }

        override fun status() = status

        override fun latest() = reading
    }

    private var now = 50_000L
    private val reading = SourceReading("track:1", "Song A", "Band A", 180_000, true, 10_000, 49_200)

    /** A follower with the fakes' logs cleared after its start-up drop (tested on its own below). */
    private fun follower(source: MusicSource, access: ListenerAccess) = Follower(source, access) { now }.also {
        (source as? FakeSource)?.calls?.clear()
        (access as? FakeAccess)?.switches?.clear()
    }

    @Test
    fun `a new follower follows nothing and has the listener off, whichever mode opens`() {
        val access = FakeAccess(grant = true)
        val source = FakeSource(SourceStatus.READING, reading)
        val f = Follower(source, access) { now }
        assertFalse(f.following)
        assertEquals(listOf("stop"), source.calls)
        assertEquals(listOf(false), access.switches)
        assertEquals(mapOf("state" to "stopped"), f.reading())
    }

    @Test
    fun `without access following does not start, the source is never started and the listener stays off`() {
        val access = FakeAccess(grant = false)
        val source = FakeSource()
        val f = follower(source, access)
        assertEquals(mapOf("granted" to false), f.followAccess())
        assertEquals(mapOf("state" to "noAccess"), f.follow())
        assertFalse(f.following)
        assertEquals(emptyList<String>(), source.calls)
        assertEquals(emptyList<Boolean>(), access.switches)
        assertEquals(mapOf("state" to "stopped"), f.reading())
    }

    @Test
    fun `opening the setting enables the listener first, so the setting lists it`() {
        val access = FakeAccess()
        val f = follower(FakeSource(), access)
        assertEquals(mapOf("state" to "opened"), f.openFollowSetting())
        assertEquals(listOf(true), access.switches)
        assertEquals(1, access.opened)
        access.opens = false
        assertEquals(mapOf("state" to "notOpened"), f.openFollowSetting())
    }

    @Test
    fun `the stand-in source says unavailable, so the page stays on the manual clock`() {
        val access = FakeAccess(grant = true)
        val f = follower(UnavailableSource, access)
        assertEquals(mapOf("state" to "unavailable"), f.follow())
        assertFalse(f.following)
        assertEquals(mapOf("state" to "stopped"), f.reading())
        assertEquals(emptyList<Boolean>(), access.switches)
    }

    @Test
    fun `an unavailable reader answers unavailable even without access, so no one is sent to the setting`() {
        val access = FakeAccess(grant = false)
        val f = follower(UnavailableSource, access)
        assertEquals(mapOf("state" to "unavailable"), f.follow())
        assertFalse(f.following)
        assertEquals(emptyList<Boolean>(), access.switches)
        assertEquals(0, access.opened)
    }

    @Test
    fun `with access it follows, starts the source once and answers each reading dated by its age`() {
        val access = FakeAccess(grant = true)
        val source = FakeSource(SourceStatus.READING, reading)
        val f = follower(source, access)
        assertEquals(mapOf("state" to "following"), f.follow())
        assertEquals(mapOf("state" to "following"), f.follow())
        assertEquals(listOf("start"), source.calls)
        assertTrue(f.following)
        val answer = f.reading()
        assertEquals("reading", answer["state"])
        @Suppress("UNCHECKED_CAST")
        val fields = answer["reading"] as Map<String, Any?>
        assertEquals(800L, fields["ageMs"])
        assertEquals("track:1", fields["trackId"])
        source.status = SourceStatus.NOTHING
        assertEquals(mapOf("state" to "nothing"), f.reading())
    }

    @Test
    fun `access taken back while following ends following`() {
        val access = FakeAccess(grant = true)
        val source = FakeSource(SourceStatus.READING, reading)
        val f = follower(source, access)
        f.follow()
        access.grant = false
        assertEquals(mapOf("state" to "noAccess"), f.reading())
        assertFalse(f.following)
        assertEquals(listOf("start", "stop"), source.calls)
    }

    @Test
    fun `unfollow stops the source and keeps the listener for the next follow`() {
        val access = FakeAccess(grant = true)
        val source = FakeSource(SourceStatus.READING, reading)
        val f = follower(source, access)
        f.follow()
        assertEquals(mapOf("state" to "stopped"), f.unfollow())
        assertEquals(listOf("start", "stop"), source.calls)
        assertEquals(listOf(true), access.switches)
        assertEquals(mapOf("state" to "stopped"), f.reading())
    }

    @Test
    fun `drop, the switch to rider mode, stops the source and disables the listener`() {
        val access = FakeAccess(grant = true)
        val source = FakeSource(SourceStatus.READING, reading)
        val f = follower(source, access)
        f.follow()
        f.drop()
        assertFalse(f.following)
        assertEquals(listOf("start", "stop"), source.calls)
        assertEquals(listOf(true, false), access.switches)
        assertEquals(mapOf("state" to "stopped"), f.reading())
    }
}
