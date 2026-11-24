package org.classbeat.player.policy

import java.net.URI
import java.net.URISyntaxException

// Where the web view may go (issue #627). Pure: java.net.URI only, no Android import.
//
// The page is the bundle the APK carries, served by Capacitor at https://localhost/. The web view
// never leaves it: a link the user taps to another https site opens in the system browser, and
// everything else (another scheme, a frame, a redirect without a tap, Capacitor's /_capacitor_
// paths that serve device files or proxy remote content) is refused.

object NavigationPolicy {
    const val APP_ORIGIN = "https://localhost"

    /** Capacitor's special paths (local files, content URIs, its HTTP proxy): never served. */
    const val CAPACITOR_PREFIX = "/_capacitor_"

    enum class Decision { LOAD, BROWSER, REFUSE }

    private fun parse(url: String): URI? =
        try {
            URI(url).normalize()
        } catch (_: URISyntaxException) {
            null
        }

    /** True for a URL of the bundle: https://localhost, no port or user, not a Capacitor path. */
    fun isBundled(url: String): Boolean {
        val u = parse(url) ?: return false
        if (!u.isAbsolute || u.isOpaque) return false
        if (u.scheme != "https" || u.host != "localhost") return false
        if (u.port != -1 || u.rawUserInfo != null) return false
        val path = u.rawPath ?: return false
        if (path.contains("..") || path.contains("%2e", ignoreCase = true)) return false
        return !path.startsWith(CAPACITOR_PREFIX)
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
