package org.classbeat.player.backend

/**
 * A strict JSON reader for the backend's answers (RFC 8259), in plain Kotlin: android.jar's
 * org.json is not there in JVM tests, and it would read numbers and duplicate keys loosely. Pure.
 *
 * Values come back as JavaScript's JSON.parse gives them, so the content hash is the desktop's:
 * an object is a Map (in the order read), an array a List, a number a Double, then String, Boolean
 * and null. A duplicate key, a lone surrogate, trailing text or nesting deeper than [MAX_DEPTH] is
 * refused: the server never sends one, and the app never guesses what it meant.
 */
object Json {
    const val MAX_DEPTH = 64

    class Malformed(message: String) : Exception(message)

    fun parse(text: String): Any? {
        val reader = Reader(text)
        reader.space()
        val value = reader.value(0)
        reader.space()
        if (!reader.end) throw Malformed("text after the value")
        return value
    }

    /** The value, or a failure for anything that is not JSON. Never throws. */
    fun tryParse(text: String): Result<Any?> =
        try {
            Result.success(parse(text))
        } catch (e: Malformed) {
            Result.failure(e)
        } catch (e: NumberFormatException) {
            Result.failure(e)
        }

    private class Reader(private val s: String) {
        private var i = 0

        val end: Boolean get() = i >= s.length

        fun space() {
            while (i < s.length && s[i] in " \t\n\r") i++
        }

        private fun fail(what: String): Nothing = throw Malformed(what)

        private fun expect(c: Char) {
            if (i >= s.length || s[i] != c) fail("expected $c")
            i++
        }

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) fail("too deep")
            if (end) fail("no value")
            return when (s[i]) {
                '{' -> obj(depth)
                '[' -> array(depth)
                '"' -> string()
                't' -> word("true", true)
                'f' -> word("false", false)
                'n' -> word("null", null)
                else -> number()
            }
        }

        private fun word(w: String, v: Any?): Any? {
            if (!s.startsWith(w, i)) fail("bad word")
            i += w.length
            return v
        }

        private fun obj(depth: Int): Map<String, Any?> {
            expect('{')
            val out = LinkedHashMap<String, Any?>()
            space()
            if (!end && s[i] == '}') return out.also { i++ }
            while (true) {
                space()
                val key = string()
                if (out.containsKey(key)) fail("duplicate key")
                space()
                expect(':')
                space()
                out[key] = value(depth + 1)
                space()
                if (end) fail("open object")
                if (s[i] == ',') i++ else return out.also { expect('}') }
            }
        }

        private fun array(depth: Int): List<Any?> {
            expect('[')
            val out = ArrayList<Any?>()
            space()
            if (!end && s[i] == ']') return out.also { i++ }
            while (true) {
                space()
                out += value(depth + 1)
                space()
                if (end) fail("open array")
                if (s[i] == ',') i++ else return out.also { expect(']') }
            }
        }

        private fun string(): String {
            expect('"')
            val out = StringBuilder()
            while (true) {
                if (end) fail("open string")
                val c = s[i++]
                when {
                    c == '"' -> break
                    c == '\\' -> out.append(escape())
                    c < ' ' -> fail("control character in a string")
                    else -> out.append(c)
                }
            }
            val text = out.toString()
            if (!wellFormed(text)) fail("lone surrogate")
            return text
        }

        private fun escape(): Char {
            if (end) fail("open escape")
            return when (val c = s[i++]) {
                '"', '\\', '/' -> c
                'b' -> '\b'
                'f' -> '\u000c'
                'n' -> '\n'
                'r' -> '\r'
                't' -> '\t'
                'u' -> {
                    if (i + 4 > s.length) fail("short escape")
                    val hex = s.substring(i, i + 4)
                    if (!hex.all { it in "0123456789abcdefABCDEF" }) fail("bad escape")
                    i += 4
                    hex.toInt(16).toChar()
                }
                else -> fail("bad escape")
            }
        }

        private fun number(): Double {
            val start = i
            if (!end && s[i] == '-') i++
            if (end) fail("bad number")
            if (s[i] == '0') i++ else digits()
            if (!end && s[i] == '.') {
                i++
                digits()
            }
            if (!end && (s[i] == 'e' || s[i] == 'E')) {
                i++
                if (!end && (s[i] == '+' || s[i] == '-')) i++
                digits()
            }
            val v = s.substring(start, i).toDouble()
            if (v.isInfinite()) fail("number out of range")
            return v
        }

        private fun digits() {
            val start = i
            while (i < s.length && s[i] in '0'..'9') i++
            if (i == start) fail("bad number")
        }
    }

    /** No lone surrogate: every high one followed by a low one, and no low one alone. */
    private fun wellFormed(t: String): Boolean {
        var k = 0
        while (k < t.length) {
            val c = t[k]
            if (c.isHighSurrogate()) {
                if (k + 1 >= t.length || !t[k + 1].isLowSurrogate()) return false
                k += 2
            } else {
                if (c.isLowSurrogate()) return false
                k++
            }
        }
        return true
    }
}
