package org.classbeat.player.policy

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URISyntaxException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// Where the web view may go (issue #627). Pure: java.net and java.nio only, no Android import.
//
// The page is the bundle the APK carries, served by Capacitor at https://localhost/. The web view
// never leaves it: a link the user taps to another https site opens in the system browser, and
// everything else (another scheme, a frame, a redirect without a tap, Capacitor's /_capacitor_
// paths that serve device files or proxy remote content) is refused.
//
// Capacitor's local server matches its special paths on the *decoded* path (android.net.Uri
// getPath), so the decision is made on the decoded path too. A malformed escape or invalid UTF-8,
// an escape that decodes to another escape, a dot or empty segment, a backslash or a control
// character is refused, and no segment may start with "_capacitor_" in any letter case.

object NavigationPolicy {
    const val APP_ORIGIN = "https://localhost"

    /** Capacitor's special paths (local files, content URIs, its HTTP proxy): never served. */
    const val CAPACITOR_PREFIX = "/_capacitor_"
    private val CAPACITOR_SEGMENT = CAPACITOR_PREFIX.substring(1)

    enum class Decision { LOAD, BROWSER, REFUSE }

    private fun parse(url: String): URI? =
        try {
            URI(url)
        } catch (_: URISyntaxException) {
            null
        }

    /** Strict percent-decoding as UTF-8; null for a bad escape or invalid UTF-8. */
    fun decodePath(raw: String): String? {
        val bytes = ByteArrayOutputStream()
        var i = 0
        while (i < raw.length) {
            if (raw[i] == '%') {
                if (i + 2 > raw.lastIndex) return null
                val hi = Character.digit(raw[i + 1], 16)
                val lo = Character.digit(raw[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                bytes.write(raw[i].toString().toByteArray(Charsets.UTF_8))
                i += 1
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString()
        } catch (_: CharacterCodingException) {
            null
        }
    }

    /** True for the raw path of a bundle file, judged on its decoded form. */
    private fun isBundlePath(raw: String): Boolean {
        if (raw.isEmpty()) return true
        val path = decodePath(raw) ?: return false
        if (!path.startsWith("/")) return false
        if (path.any { it == '%' || it == '\\' || it.isISOControl() }) return false
        val segments = path.substring(1).split('/')
        return segments.withIndex().none { (i, seg) ->
            (seg.isEmpty() && i != segments.lastIndex) ||
                seg == "." ||
                seg == ".." ||
                seg.startsWith(CAPACITOR_SEGMENT, ignoreCase = true)
        }
    }

    /** True for a URL of the bundle: https://localhost, no port or user, not a Capacitor path. */
    fun isBundled(url: String): Boolean {
        val u = parse(url) ?: return false
        if (!u.isAbsolute || u.isOpaque) return false
        if (u.scheme != "https" || u.host != "localhost") return false
        if (u.port != -1 || u.rawUserInfo != null) return false
        return isBundlePath(u.rawPath ?: return false)
    }

    /** A request the web view makes for a resource: only the bundle's own files are served. */
    fun serves(url: String): Boolean = isBundled(url)

    /** A navigation: the bundle loads in place; a tapped https link to a site opens in the browser. */
    fun navigate(url: String, mainFrame: Boolean, userGesture: Boolean): Decision {
        if (isBundled(url)) return if (mainFrame) Decision.LOAD else Decision.REFUSE
        if (!mainFrame || !userGesture) return Decision.REFUSE
        val u = parse(url) ?: return Decision.REFUSE
        if (!u.isAbsolute || u.isOpaque || u.scheme != "https") return Decision.REFUSE
        val host = u.host ?: return Decision.REFUSE
        if (host == "localhost" || u.rawUserInfo != null) return Decision.REFUSE
        return Decision.BROWSER
    }
}
