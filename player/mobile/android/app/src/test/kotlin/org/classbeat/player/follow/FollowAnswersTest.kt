package org.classbeat.player.follow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The pure mapping from a source reading to the page's fields (issue #632). */
class FollowAnswersTest {
    private val now = 100_000L
    private val good = SourceReading("abc:track:0123456789", "Song A", "Band A", 180_000, true, 42_000, 99_000)

    @Test
    fun `a reading becomes exactly the fields the music link needs, dated by its age`() {
        assertEquals(
            mapOf(
                "trackId" to "abc:track:0123456789",
                "title" to "Song A",
                "artist" to "Band A",
                "lengthMs" to 180_000L,
                "playing" to true,
                "positionMs" to 42_000L,
                "ageMs" to 1_000L,
            ),
            FollowAnswers.fields(good, now),
        )
    }

    @Test
    fun `status without a usable reading answers its state only`() {
        assertEquals(mapOf("state" to "unavailable"), FollowAnswers.reading(SourceStatus.UNAVAILABLE, good, now))
        assertEquals(mapOf("state" to "nothing"), FollowAnswers.reading(SourceStatus.NOTHING, good, now))
        assertEquals(mapOf("state" to "nothing"), FollowAnswers.reading(SourceStatus.READING, null, now))
        assertEquals("reading", FollowAnswers.reading(SourceStatus.READING, good, now)["state"])
    }

    @Test
    fun `numbers that cannot be used drop the reading`() {
        assertNull(FollowAnswers.fields(good.copy(positionMs = -1), now))
        assertNull(FollowAnswers.fields(good.copy(positionAt = -1), now))
        assertNull("a position set in the future", FollowAnswers.fields(good.copy(positionAt = now + 1), now))
        assertNull("no title and no id", FollowAnswers.fields(good.copy(title = " \n", trackId = null), now))
    }

    @Test
    fun `an odd id or length is dropped, text is cleaned and cut`() {
        val f = FollowAnswers.fields(good.copy(trackId = "has space", lengthMs = 0, title = "A\u0000B\n", artist = "x".repeat(500)), now)!!
        assertNull(f["trackId"])
        assertNull(f["lengthMs"])
        assertEquals("AB", f["title"])
        assertEquals(FollowAnswers.MAX_TEXT, (f["artist"] as String).length)
        assertNull(FollowAnswers.fields(good.copy(trackId = "x".repeat(129)), now)!!["trackId"])
        assertEquals("Song A", FollowAnswers.fields(good.copy(trackId = null), now)!!["title"])
    }
}
