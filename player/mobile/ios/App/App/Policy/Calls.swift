// The fixed backend calls the phone makes, chosen in native code (issue #896, ADR 0016 section 4):
// the Swift twin of Android's Calls.kt. The page never names a path or an address: native code
// picks one of these, and the device token is added only to the player calls. `allowed` is the
// transport's last check that nothing else is ever made. Pure: WholeMatch for the patterns.
enum Calls {
    static let platform = "ios"
    static let pageSize = 100
    static let maxPageBytes = 1024 * 1024
    static let maxClassBytes = 2 * 1024 * 1024

    private static let uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    private static let maxPosition = 9_007_199_254_740_991

    static func isClassId(_ id: String) -> Bool { WholeMatch.matches(id, uuid) }

    static func pairingStart(_ origin: String, _ version: String) -> BackendRequest {
        BackendRequest(origin, .post, "/api/pairing/start", body: ["platform": platform, "version": version])
    }

    static func pairingToken(_ origin: String, _ deviceCode: String) -> BackendRequest {
        BackendRequest(origin, .post, "/api/pairing/token", body: ["device_code": deviceCode])
    }

    static func device(_ origin: String, _ token: String) -> BackendRequest {
        BackendRequest(origin, .get, "/api/player/device", token: token)
    }

    static func revoke(_ origin: String, _ token: String) -> BackendRequest {
        BackendRequest(origin, .delete, "/api/player/device", token: token)
    }

    /// Nil for a cursor out of range.
    static func changes(_ origin: String, _ token: String, after: Int) -> BackendRequest? {
        guard after >= 0, after <= maxPosition else { return nil }
        let path = "/api/player/changes?after=\(after)&limit=\(pageSize)"
        return BackendRequest(origin, .get, path, token: token, maxBodyBytes: maxPageBytes)
    }

    /// Nil for anything but a class id.
    static func classDocument(_ origin: String, _ token: String, _ id: String) -> BackendRequest? {
        guard isClassId(id) else { return nil }
        return BackendRequest(origin, .get, "/api/player/classes/" + id, token: token, maxBodyBytes: maxClassBytes)
    }

    /// True only for a method and path one of the builders above makes, with the token on the
    /// player calls and never on the pairing calls.
    static func allowed(_ method: HttpMethod, _ path: String, withToken: Bool) -> Bool {
        if withToken != path.hasPrefix("/api/player/") { return false }
        switch method {
        case .post: return path == "/api/pairing/start" || path == "/api/pairing/token"
        case .delete: return path == "/api/player/device"
        case .get:
            return path == "/api/player/device"
                || WholeMatch.matches(path, "/api/player/changes\\?after=(0|[1-9][0-9]{0,15})&limit=\(pageSize)")
                || WholeMatch.matches(path, "/api/player/classes/" + uuid)
        }
    }
}
