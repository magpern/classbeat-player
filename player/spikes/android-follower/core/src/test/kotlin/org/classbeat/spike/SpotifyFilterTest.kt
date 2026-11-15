package org.classbeat.spike

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SpotifyFilterTest {
    private data class Fake(val pkg: String?, val tag: String)

    @Test
    fun onlyTheSpotifyPackageMatches() {
        assertTrue(isSpotify("com.spotify.music"))
        for (other in listOf(null, "", "com.spotify.musicx", "com.spotify.lite", "COM.SPOTIFY.MUSIC", "com.google.android.youtube", "org.example.com.spotify.music")) {
            assertFalse(isSpotify(other), "$other")
        }
    }

    @Test
    fun filterKeepsSpotifySessionsInOrderAndNothingElse() {
        val sessions = listOf(Fake("com.google.android.apps.youtube.music", "yt"), Fake("com.spotify.music", "a"), Fake(null, "n"), Fake("com.spotify.music", "b"))
        assertEquals(listOf("a", "b"), spotifyOnly(sessions) { it.pkg }.map { it.tag })
        assertEquals(emptyList(), spotifyOnly(listOf(Fake("org.videolan.vlc", "v"))) { it.pkg })
    }

    @Test
    fun filterAsksOnlyForThePackageName() {
        var asked = 0
        spotifyOnly(listOf(Fake("com.spotify.music", "a"), Fake("x", "b"))) { asked++; it.pkg }
        assertEquals(2, asked)
    }
}
