package org.classbeat.player.follow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The media-session reader on fake sessions (issue #653): no phone, no music app, no audio. */
class SessionReaderTest {
    private class FakeSession(
        override val app: String,
        var track: SessionTrack? = SessionTrack("track:1", "Song A", "Band A", 180_000),
        var state: SessionState? = SessionState(true, 10_000, 49_200),
    ) : Session {
        /** Every read and command, in order: a session from another app must stay at zero. */
        val calls = mutableListOf<String>()

        override fun track(): SessionTrack? = track.also { calls += "track" }

        override fun state(): SessionState? = state.also { calls += "state" }

        override fun send(command: TransportCommand) {
            calls += "send $command"
        }
    }

    /** The port as the system would list sessions: [list] unfiltered, or null without access. */
    private class FakeSessions(var list: List<Session>?, var exists: Boolean = true) : Sessions {
        override val app = MINE
        var listed = 0

        override fun exists() = exists

        override fun active(): List<Session>? = list.also { listed++ }
    }

    private val other = FakeSession(OTHER, SessionTrack("other:9", "Their song", "Them", 1), SessionState(true, 1, 1))

    @Test
    fun `it reads only its own app's session and never anything of another app's`() {
        val mine = FakeSession(MINE)
        val reader = SessionReader(FakeSessions(listOf(other, mine, FakeSession(OTHER))))
        reader.start()
        assertEquals(SourceStatus.READING, reader.status())
        assertEquals(SourceReading("track:1", "Song A", "Band A", 180_000, true, 10_000, 49_200), reader.latest())
        assertEquals(listOf("track", "state"), mine.calls)
        assertEquals(emptyList<String>(), other.calls)
    }

    @Test
    fun `with only another app's session it has nothing, and reads nothing of it`() {
        val reader = SessionReader(FakeSessions(listOf(other)))
        reader.start()
        assertEquals(SourceStatus.NOTHING, reader.status())
        assertNull(reader.latest())
        assertFalse(reader.command(TransportCommand.PLAY))
        assertEquals(emptyList<String>(), other.calls)
    }

    @Test
    fun `nothing is listed or read before start or after stop, and stop forgets the reading`() {
        val mine = FakeSession(MINE)
        val sessions = FakeSessions(listOf(mine))
        val reader = SessionReader(sessions)
        assertEquals(SourceStatus.NOTHING, reader.status())
        assertNull(reader.latest())
        assertFalse(reader.command(TransportCommand.PLAY))
        reader.start()
        assertEquals(SourceStatus.READING, reader.status())
        reader.stop()
        assertNull(reader.latest())
        assertEquals(SourceStatus.NOTHING, reader.status())
        assertFalse(reader.command(TransportCommand.PAUSE))
        assertEquals(1, sessions.listed)
        assertEquals(listOf("track", "state"), mine.calls)
    }

    @Test
    fun `unavailable only when the phone has no media sessions, never for missing access`() {
        // No access or the listener unbound: the system refuses the list. Not "unavailable", or
        // Follower.follow would never send the instructor to the setting (review of #837).
        val refused = SessionReader(FakeSessions(null))
        assertEquals(SourceStatus.NOTHING, refused.status())
        refused.start()
        assertEquals(SourceStatus.NOTHING, refused.status())
        val access = FakeAccess(grant = false)
        assertEquals(mapOf("state" to "noAccess"), Follower(SessionReader(FakeSessions(null)), access) { 0 }.follow())
        // No media sessions at all: unavailable, before and after start.
        val none = SessionReader(FakeSessions(listOf(FakeSession(MINE)), exists = false))
        assertEquals(SourceStatus.UNAVAILABLE, none.status())
        none.start()
        assertEquals(SourceStatus.UNAVAILABLE, none.status())
        assertNull(none.latest())
    }

    @Test
    fun `a session with no track or no play state gives no reading`() {
        val mine = FakeSession(MINE, track = null)
        val reader = SessionReader(FakeSessions(listOf(mine)))
        reader.start()
        assertEquals(SourceStatus.NOTHING, reader.status())
        mine.track = SessionTrack(null, "Song A", "", null)
        mine.state = null
        assertEquals(SourceStatus.NOTHING, reader.status())
        mine.state = SessionState(false, 5_000, 40_000)
        assertEquals(SourceStatus.READING, reader.status())
        assertEquals(SourceReading(null, "Song A", "", null, false, 5_000, 40_000), reader.latest())
    }

    @Test
    fun `transport goes to its own app's session only, while following`() {
        val mine = FakeSession(MINE)
        val reader = SessionReader(FakeSessions(listOf(other, mine)))
        reader.start()
        for (c in TransportCommand.entries) assertTrue(reader.command(c))
        assertEquals(listOf("send PLAY", "send PAUSE", "send NEXT"), mine.calls)
        assertEquals(emptyList<String>(), other.calls)
    }

    @Test
    fun `real readings reach the page through the follower, dated by their age`() {
        val sessions = FakeSessions(listOf(other, FakeSession(MINE)))
        val f = Follower(SessionReader(sessions), FakeAccess(grant = true)) { 50_000 }
        assertEquals(mapOf("state" to "following"), f.follow())
        val expected = mapOf(
            "trackId" to "track:1",
            "title" to "Song A",
            "artist" to "Band A",
            "lengthMs" to 180_000L,
            "playing" to true,
            "positionMs" to 10_000L,
            "ageMs" to 800L,
        )
        assertEquals(mapOf("state" to "reading", "reading" to expected), f.reading())
        assertEquals(emptyList<String>(), other.calls)
        // The music app closes its session: nothing to follow, and no stale reading.
        sessions.list = listOf(other)
        assertEquals(mapOf("state" to "nothing"), f.reading())
        // Following stopped: nothing more is listed.
        f.unfollow()
        val listed = sessions.listed
        assertEquals(mapOf("state" to "stopped"), f.reading())
        assertEquals(listed, sessions.listed)
    }

    private class FakeAccess(val grant: Boolean) : ListenerAccess {
        override fun granted() = grant

        override fun enable(on: Boolean) {}

        override fun openSetting() = true
    }

    private companion object {
        const val MINE = "org.example.music"
        const val OTHER = "org.example.other"
    }
}
