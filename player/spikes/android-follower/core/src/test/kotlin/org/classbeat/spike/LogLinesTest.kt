package org.classbeat.spike

import kotlin.test.Test
import kotlin.test.assertEquals

class LogLinesTest {
    private val stamp = Stamp(monoMs = 1_000_300, wallMs = 1_763_000_000_000)
    private val reading = Reading(
        trackId = "spotify:track:ABC", title = "Sång \"A\"", artist = "Ärtist", positionMs = 42_000, durationMs = 180_000,
        state = PlayState.PLAYING, readAtMs = 1_000_000, polledAtMs = 1_000_300, source = SOURCE, app = SPOTIFY_PACKAGE,
    )

    @Test
    fun readingLineHasSpikeOnesFieldsInOrder() {
        assertEquals(
            """{"t":"reading","monoMs":1000300,"wallMs":1763000000000,"reading":{"trackId":"spotify:track:ABC","title":"Sång \"A\"","artist":"Ärtist","positionMs":42000,"durationMs":180000,"state":"playing","readAtMs":1000000,"polledAtMs":1000300,"source":"android-media-session","app":"com.spotify.music"}}""",
            readingLine(stamp, reading),
        )
    }

    @Test
    fun noReadingIsNull() {
        assertEquals("""{"t":"reading","monoMs":1000300,"wallMs":1763000000000,"reading":null}""", readingLine(stamp, null))
    }

    @Test
    fun nullFieldsStayInTheLine() {
        val line = readingLine(stamp, reading.copy(trackId = null, durationMs = null, artist = ""))
        assertEquals(true, line.contains(""""trackId":null,"title":"Sång \"A\"","artist":"","positionMs":42000,"durationMs":null"""))
    }

    @Test
    fun markersAndControlsMatchSpikeOnesShape() {
        assertEquals("""{"t":"marker","monoMs":1000300,"wallMs":1763000000000,"key":"b","classTimeMs":null}""", markerLine(stamp, "b"))
        assertEquals("""{"t":"control","monoMs":1000300,"wallMs":1763000000000,"key":"undo","decision":null}""", controlLine(stamp, "undo"))
        assertEquals("""{"t":"reader_error","monoMs":1000300,"wallMs":1763000000000,"text":"no access"}""", readerErrorLine(stamp, "no access"))
    }

    @Test
    fun metaLineCarriesNestedValues() {
        val line = metaLine(stamp, linkedMapOf("event" to "start", "device" to mapOf("model" to "Pixel"), "limitations" to listOf("a", "b"), "x" to null))
        assertEquals("""{"t":"meta","monoMs":1000300,"wallMs":1763000000000,"event":"start","device":{"model":"Pixel"},"limitations":["a","b"],"x":null}""", line)
    }

    @Test
    fun stringsEscapeControlCharacters() {
        assertEquals("\"a\\\\b\\n\\t\\u0001\"", jsonString("a\\b\n\t\u0001"))
        assertEquals("null", jsonValue(Double.NaN))
    }

    @Test
    fun fpsLinesRoundToOneDecimal() {
        assertEquals("""{"t":"fps","monoMs":1000300,"wallMs":1763000000000,"second":3,"frames":59,"fps":58.7,"sceneFps":null}""", fpsLine(stamp, 3, 59, 58.7312, null))
        assertEquals(true, fpsLine(stamp, 3, 59, 58.7, 60.0).endsWith(""""sceneFps":60.0}"""))
    }
}
