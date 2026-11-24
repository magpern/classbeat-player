package org.classbeat.player.policy

import org.classbeat.player.backend.CanonicalJson

/**
 * The last check before any answer or event goes over the bridge to the page (ADR 0011 §5, issue
 * #631): written out whole, it must not contain a secret the phone holds, the device token or the
 * pairing's device code, in full or in any part long enough to matter. Pure.
 */
object AnswerPolicy {
    /** A run of a secret this long is refused anywhere in an answer: past the `cbp_dev_` prefix. */
    const val MIN_PART = 12

    /** True when [answer] may be sent: it can be written as JSON and holds no part of any of [secrets]. */
    fun mayAnswer(answer: Any?, secrets: List<String>): Boolean {
        val text = try {
            CanonicalJson.write(answer)
        } catch (e: CanonicalJson.Unsupported) {
            return false
        }
        // A secret's characters (letters, digits, `_` and `-`) are never escaped, so the text holds it as is.
        return secrets.none { leaks(text, it) }
    }

    private fun leaks(text: String, secret: String): Boolean {
        if (secret.isEmpty()) return false
        if (secret.length <= MIN_PART) return text.contains(secret)
        return (0..secret.length - MIN_PART).any { text.contains(secret.substring(it, it + MIN_PART)) }
    }
}
