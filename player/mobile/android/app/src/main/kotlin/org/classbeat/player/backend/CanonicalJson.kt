package org.classbeat.player.backend

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.security.MessageDigest

/**
 * RFC 8785 canonical JSON, the bytes the class's content hash is taken over (the backend's
 * `sha256:` + hex of SHA-256 of the canonical document). Pure.
 *
 * Takes the values [Json.parse] gives. Keys are sorted by UTF-16 code units (String.compareTo),
 * strings escape only what RFC 8785 says, and numbers are written as ECMAScript writes them.
 */
object CanonicalJson {
    class Unsupported(message: String) : Exception(message)

    fun write(value: Any?): String = StringBuilder().also { write(value, it) }.toString()

    /** `sha256:<64 lowercase hex>` of the canonical form, as the backend sends `content_hash`. */
    fun contentHash(value: Any?): String {
        val bytes = write(value).toByteArray(Charsets.UTF_8)
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return "sha256:" + digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun write(value: Any?, out: StringBuilder) {
        when (value) {
            null -> out.append("null")
            is Boolean -> out.append(if (value) "true" else "false")
            is String -> string(value, out)
            is Double -> out.append(number(value))
            is Int -> out.append(number(value.toDouble()))
            is Long -> out.append(number(value.toDouble()))
            is Map<*, *> -> {
                out.append('{')
                val keys = value.keys.map { it as? String ?: throw Unsupported("a key that is not text") }
                keys.sorted().forEachIndexed { i, key ->
                    if (i > 0) out.append(',')
                    string(key, out)
                    out.append(':')
                    write(value[key], out)
                }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                value.forEachIndexed { i, item ->
                    if (i > 0) out.append(',')
                    write(item, out)
                }
                out.append(']')
            }
            else -> throw Unsupported("a value JSON cannot hold")
        }
    }

    private fun string(s: String, out: StringBuilder) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\b' -> out.append("\\b")
                '\t' -> out.append("\\t")
                '\n' -> out.append("\\n")
                '\u000c' -> out.append("\\f")
                '\r' -> out.append("\\r")
                else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
            }
        }
        out.append('"')
    }

    /** ECMAScript Number::toString: the shortest digits that read back, placed as JS places them. */
    fun number(x: Double): String {
        if (x.isNaN() || x.isInfinite()) throw Unsupported("not a finite number")
        if (x == 0.0) return "0"
        val sign = if (x < 0) "-" else ""
        val exact = shortest(Math.abs(x))
        val digits = exact.unscaledValue().toString()
        val k = digits.length
        val n = k - exact.scale()
        val body = when {
            n in k..21 -> digits + "0".repeat(n - k)
            n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
            n in -5..0 -> "0." + "0".repeat(-n) + digits
            else -> {
                val e = n - 1
                val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
                mantissa + "e" + (if (e < 0) "-" else "+") + Math.abs(e)
            }
        }
        return sign + body
    }

    /**
     * The fewest significant digits that read back as [x], and of those the closest to it, as
     * ECMAScript asks. Double.toString is not used: on some runtimes it keeps a second digit
     * (4.9E-324 for 5e-324), and Android's has differed from the JDK's.
     */
    private fun shortest(x: Double): BigDecimal {
        val exact = BigDecimal(x)
        for (p in 1..17) {
            val near = exact.round(MathContext(p, RoundingMode.HALF_EVEN))
            if (near.toDouble() == x) return near.stripTrailingZeros()
        }
        return exact.round(MathContext(17, RoundingMode.HALF_EVEN)).stripTrailingZeros()
    }
}
