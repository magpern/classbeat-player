package org.classbeat.player.backend

/**
 * The fixed backend calls the phone makes, chosen in native code (ADR 0011 §3). Pure.
 *
 * The page never names a path or an address: an intent asks for one of these, and the device token
 * is added only to the four player calls below (list, class, sync, device check and revoke).
 * [allowed] is the transport's last check that nothing else is ever sent.
 */
object Calls {
    const val PLATFORM = "android"
    const val PAGE_SIZE = 100
    const val MAX_PAGE_BYTES = 1024 * 1024
    const val MAX_CLASS_BYTES = 2 * 1024 * 1024

    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private const val MAX_POSITION = 9_007_199_254_740_991L

    fun isClassId(id: String): Boolean = UUID.matches(id)

    fun pairingStart(origin: String, version: String) =
        BackendRequest(origin, Method.POST, "/api/pairing/start", mapOf("platform" to PLATFORM, "version" to version))

    fun pairingToken(origin: String, deviceCode: String) =
        BackendRequest(origin, Method.POST, "/api/pairing/token", mapOf("device_code" to deviceCode))

    fun device(origin: String, token: String) = BackendRequest(origin, Method.GET, "/api/player/device", token = token)

    fun revoke(origin: String, token: String) = BackendRequest(origin, Method.DELETE, "/api/player/device", token = token)

    fun changes(origin: String, token: String, after: Long): BackendRequest {
        require(after in 0..MAX_POSITION) { "cursor out of range" }
        val path = "/api/player/changes?after=$after&limit=$PAGE_SIZE"
        return BackendRequest(origin, Method.GET, path, token = token, maxBodyBytes = MAX_PAGE_BYTES)
    }

    fun classDocument(origin: String, token: String, id: String): BackendRequest {
        require(isClassId(id)) { "not a class id" }
        return BackendRequest(origin, Method.GET, "/api/player/classes/$id", token = token, maxBodyBytes = MAX_CLASS_BYTES)
    }

    private val CHANGES = Regex("^/api/player/changes\\?after=(0|[1-9][0-9]{0,15})&limit=$PAGE_SIZE$")
    private val CLASS = Regex("^/api/player/classes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    /**
     * True only for a method and path one of the builders above makes, with the token on the player
     * calls and never on the pairing calls.
     */
    fun allowed(method: Method, path: String, withToken: Boolean): Boolean {
        if (withToken != path.startsWith("/api/player/")) return false
        return when (method) {
            Method.POST -> path == "/api/pairing/start" || path == "/api/pairing/token"
            Method.DELETE -> path == "/api/player/device"
            Method.GET -> path == "/api/player/device" || CHANGES.matches(path) || CLASS.matches(path)
        }
    }
}
