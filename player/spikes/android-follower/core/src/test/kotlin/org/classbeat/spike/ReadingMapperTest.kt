package org.classbeat.spike

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ReadingMapperTest {
    private val raw = RawSession(
        mediaId = "spotify:track:ABC", title = "Spike Song A", artist = "Spike Artist", durationMs = 180_000,
        playbackState = 3, positionMs = 42_000, positionUpdatedAtMs = 1_000_000,
    )

    @Test
    fun mapsPlayingSessionToSpikeOneReading() {
        val r = assertNotNull(toReading(raw, polledAtMs = 1_000_300))
        assertEquals("spotify:track:ABC", r.trackId)
        assertEquals("Spike Song A", r.title)
        assertEquals(42_000, r.positionMs)
        assertEquals(PlayState.PLAYING, r.state)
        assertEquals(1_000_000, r.readAtMs)
        assertEquals(1_000_300, r.polledAtMs)
        assertEquals(180_000L, r.durationMs)
        assertEquals("android-media-session", r.source)
        assertEquals("com.spotify.music", r.app)
    }

    @Test
    fun statesMapByWhetherThePositionRuns() {
        val expected = mapOf(
            0 to PlayState.STOPPED, 1 to PlayState.STOPPED, 2 to PlayState.PAUSED, 3 to PlayState.PLAYING,
            4 to PlayState.PLAYING, 5 to PlayState.PLAYING, 6 to PlayState.PAUSED, 7 to PlayState.STOPPED,
            8 to PlayState.PAUSED, 9 to PlayState.PAUSED, 10 to PlayState.PAUSED, 11 to PlayState.PAUSED,
        )
        for ((code, state) in expected) assertEquals(state, mapState(code), "state $code")
    }

    @Test
    fun unsetOrFutureUpdateTimeFallsBackToThePollTime() {
        assertEquals(2_000_000, toReading(raw.copy(positionUpdatedAtMs = 0), 2_000_000)!!.readAtMs)
        assertEquals(2_000_000, toReading(raw.copy(positionUpdatedAtMs = 3_000_000), 2_000_000)!!.readAtMs)
    }

    @Test
    fun blankIdAndUnknownDurationBecomeNull() {
        val r = toReading(raw.copy(mediaId = " ", durationMs = -1), 1_000_300)!!
        assertNull(r.trackId)
        assertNull(r.durationMs)
    }

    @Test
    fun noSpotifySessionGivesNoReading() {
        assertNull(toReading(null, 1))
    }

    @Test
    fun unreadableSessionsGiveNoReadingAndAReason() {
        val noTrack = raw.copy(mediaId = null, title = null)
        val noState = raw.copy(playbackState = null)
        val noPosition = raw.copy(positionMs = -1)
        for (bad in listOf(noTrack, noState, noPosition)) {
            assertNull(toReading(bad, 1_000_300))
            assertNotNull(whyUnreadable(bad))
        }
        assertNull(whyUnreadable(raw))
    }
}
