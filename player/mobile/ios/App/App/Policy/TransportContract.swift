// The one way the phone's native code would reach the backend (issue #896, ADR 0016 section 4), as
// a contract: the Swift twin of Android's TransportContract.kt. Pure: no import at all. The rules
// every transport keeps are here; the I/O would live in an implementation.
//
// A transport calls only the origin fixed in the build, only the fixed paths in Calls, carries the
// token only in `Authorization: Bearer`, never follows a redirect, gives up after `timeoutMs`,
// reads at most the request's body cap, never throws and never logs: every failure is
// `.unreachable`. It answers on the main thread, later, never from inside `call`.
//
// iOS has no network transport yet: it waits for the owner (ADR 0016 section 4), so the app wires
// OfflineTransport and the tests a fake backend.

protocol BackendTransport: AnyObject {
    func call(_ request: BackendRequest, answer: @escaping (HttpAnswer) -> Void)
}

enum HttpMethod: String {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// One call. Its text never shows the token: a request is safe to put in a test failure.
struct BackendRequest: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let origin: String
    let method: HttpMethod
    let path: String
    /// A JSON object of text values, or nil for no body.
    let body: [String: String]?
    let token: String?
    let maxBodyBytes: Int

    init(
        _ origin: String,
        _ method: HttpMethod,
        _ path: String,
        body: [String: String]? = nil,
        token: String? = nil,
        maxBodyBytes: Int = TransportContract.maxBodyBytes
    ) {
        self.origin = origin
        self.method = method
        self.path = path
        self.body = body
        self.token = token
        self.maxBodyBytes = maxBodyBytes
    }

    var description: String { "\(method.rawValue) \(path)" + (token == nil ? "" : " (with the device token)") }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["call": description]) }
}

/// What the transport hands back: a status with its JSON body (nil when none or not JSON), or
/// nothing at all.
enum HttpAnswer {
    case http(status: Int, body: Any?, retryAfterS: Int?)
    case unreachable
}

enum TransportContract {
    static let timeoutMs = 10_000
    static let maxBodyBytes = 64 * 1024
    static let followsRedirects = false

    /// The request's headers, in full. Nothing else goes: no cookie, no `Sec-Fetch-Site`.
    static func headers(_ request: BackendRequest) -> [String: String] {
        var out = ["Accept": "application/json"]
        if request.body != nil { out["Content-Type"] = "application/json" }
        if let token = request.token { out["Authorization"] = "Bearer " + token }
        return out
    }

    /// The address to call: the fixed origin and one of the fixed paths, or nil to refuse the call.
    static func address(_ request: BackendRequest, buildOrigin: String) -> String? {
        if request.origin != buildOrigin { return nil }
        if !Calls.allowed(request.method, request.path, withToken: request.token != nil) { return nil }
        if request.maxBodyBytes < 1 || request.maxBodyBytes > Calls.maxClassBytes { return nil }
        return request.origin + request.path
    }
}

/// The stand-in for a build with no transport: every call is "offline", answered on a later turn.
final class OfflineTransport: BackendTransport {
    private let post: (@escaping () -> Void) -> Void

    init(post: @escaping (@escaping () -> Void) -> Void) {
        self.post = post
    }

    func call(_ request: BackendRequest, answer: @escaping (HttpAnswer) -> Void) {
        post { answer(.unreachable) }
    }
}
