import Foundation

// What the Keychain item holds (issue #896, ADR 0016 section 4): the device token, the account's
// email (nil for an account with none) and the backend that issued the token. The Swift twin of
// Android's PairingRecord.kt. The token is used with that backend only. Its text form never shows
// the token. Pure: Foundation's JSON only.
struct PairingRecord: Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let origin: String
    let token: String
    let email: String?

    static let maxText = 16 * 1024

    var description: String { "PairingRecord(\(origin))" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["origin": origin]) }

    /// The record as JSON text, keys sorted, so the same record is always the same text.
    func text() -> String? {
        let object: [String: Any] = ["v": 1, "origin": origin, "token": token, "email": email ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else {
            return nil
        }
        return String(decoding: data, as: UTF8.self)
    }

    static func parse(_ text: String, allowLoopbackHttp: Bool) -> PairingRecord? {
        if text.utf16.count > maxText { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)),
              let raw = object as? [String: Any],
              let origin = raw["origin"] as? String
        else { return nil }
        // Version 1, as a number: a JSON true is not 1.
        guard let v = raw["v"] as? NSNumber, CFGetTypeID(v) != CFBooleanGetTypeID(), v.doubleValue == 1 else { return nil }
        if OriginPolicy.parseBackendOrigin(origin, allowLoopbackHttp: allowLoopbackHttp) != origin { return nil }
        guard let token = raw["token"] as? String, PairingProtocol.isDeviceToken(token), let rawEmail = raw["email"] else {
            return nil
        }
        if rawEmail is NSNull { return PairingRecord(origin: origin, token: token, email: nil) }
        guard let email = PairingProtocol.shownText(rawEmail, PairingProtocol.maxEmail) else { return nil }
        return PairingRecord(origin: origin, token: token, email: email)
    }
}

/// Where the record is kept: a Keychain item, never in the clear anywhere else (issue #896). Every
/// method is synchronous and never throws.
protocol SecretStore: AnyObject {
    /// True only when the Keychain takes an item with a passcode-bound access class. No Keychain,
    /// no pairing.
    func available() -> Bool

    /// Keeps the text; false when it could not be kept (nothing half-written is left).
    func save(_ text: String) -> Bool

    /// The text, or nil when there is none or it cannot be read.
    func load() -> String?

    /// Deletes the item.
    func delete()
}

/// The store when the first-launch wipe failed: nothing is read, nothing is kept, so the app starts
/// unpaired and cannot pair until a launch where the wipe succeeds.
final class ClosedSecretStore: SecretStore {
    func available() -> Bool { false }
    func save(_ text: String) -> Bool { false }
    func load() -> String? { nil }
    func delete() {}
}
