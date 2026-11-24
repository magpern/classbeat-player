package org.classbeat.player.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonTest {
    @Test
    fun readsEveryKindOfValue() {
        val v = Json.parse(""" { "a": [1, -2.5e2, true, false, null], "b": "x\"\\\/\b\f\n\r\t\u00e9" } """)
        assertEquals(
            mapOf("a" to listOf(1.0, -250.0, true, false, null), "b" to "x\"\\/\b\u000c\n\r\té"),
            v,
        )
    }

    @Test
    fun keepsTheOrderKeysWereRead() {
        val v = Json.parse("""{"z":1,"a":2,"m":3}""") as Map<*, *>
        assertEquals(listOf("z", "a", "m"), v.keys.toList())
    }

    @Test
    fun readsASurrogatePair() {
        assertEquals("\uD83D\uDE00", Json.parse("\"\\ud83d\\ude00\""))
    }

    @Test
    fun refusesWhatIsNotStrictJson() {
        val bad = listOf(
            "", " ", "{", "[1,]", "{\"a\":1,}", "{\"a\":1,\"a\":2}", "01", "1.", ".5", "-", "+1",
            "1e", "NaN", "Infinity", "1e999", "tru", "nul", "\"open", "\"\\x\"", "\"\\u12\"",
            "\"a\u0001\"", "'a'", "{a:1}", "1 2", "[1]x", "\"\\ud800\"", "\"\\udc00x\"",
            "[".repeat(Json.MAX_DEPTH + 2),
        )
        for (text in bad) {
            assertTrue("should refuse <$text>", Json.tryParse(text).isFailure)
        }
    }

    @Test
    fun acceptsNestingUpToTheLimit() {
        val text = "[".repeat(Json.MAX_DEPTH + 1) + "]".repeat(Json.MAX_DEPTH + 1)
        assertTrue(Json.tryParse(text).isSuccess)
    }
}
