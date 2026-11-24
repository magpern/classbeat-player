package org.classbeat.player.policy

/**
 * The backend's address (ADR 0002 §6, ADR 0011 §3), as the desktop reads it. Pure.
 *
 * Fixed in the build: HTTPS, or loopback HTTP in a debug build only. A device token is sent only to
 * an address this accepts, and only to the one that issued it. Stricter than a URL parser on
 * purpose: only the plain form of an origin is accepted, so there is one way to write each.
 */
object OriginPolicy {
    private val ORIGIN = Regex("^(https|http)://([a-z0-9-]+(?:\\.[a-z0-9-]+)*|\\[::1\\])(?::([1-9][0-9]{0,4}))?$")
    private val LOOPBACK = setOf("127.0.0.1", "localhost", "[::1]")
    private val PAGE_PATH = Regex("^/[A-Za-z0-9._~/-]{0,150}$")
    private const val MAX_PAGE = 200

    /** The origin, or null when it is unset or not an origin this build may call. */
    fun parseBackendOrigin(raw: String?, allowLoopbackHttp: Boolean): String? {
        val text = raw?.trim()?.removeSuffix("/") ?: return null
        val m = ORIGIN.matchEntire(text) ?: return null
        val (scheme, host, port) = m.destructured
        val secure = scheme == "https" || (allowLoopbackHttp && host in LOOPBACK)
        if (!secure) return null
        if (port.isNotEmpty()) {
            val n = port.toInt()
            // The default port is written without it, as a browser writes the origin.
            if (n > 65535 || (scheme == "https" && n == 443) || (scheme == "http" && n == 80)) return null
        }
        return text
    }

    /**
     * The pairing page the app may open in the browser: on the backend's own origin, with no query,
     * fragment or user name (the code is typed there, never carried in the address). Null otherwise.
     */
    fun pairingPageOn(origin: String, uri: Any?): String? {
        if (uri !is String || uri.length > MAX_PAGE || !uri.startsWith("$origin/")) return null
        val path = uri.substring(origin.length)
        if (!PAGE_PATH.matches(path) || path.contains("//")) return null
        if (path.split('/').any { it == "." || it == ".." }) return null
        return uri
    }
}
