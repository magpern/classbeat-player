import Foundation
import Security

// The pairing record in the Keychain (issue #896, ADR 0016 section 4): one generic password, only
// readable while the phone is unlocked, only while it has a passcode, never synced and never in a
// backup restored to another phone (`WhenPasscodeSetThisDeviceOnly`). If the Keychain refuses it,
// the phone does not pair: there is no other place the token is ever kept.

/// The three Keychain calls, behind a protocol so a test can refuse or record each one.
protocol KeychainCalls: AnyObject {
    func add(_ query: [String: Any]) -> OSStatus
    func copy(_ query: [String: Any]) -> (OSStatus, Data?)
    func delete(_ query: [String: Any]) -> OSStatus
}

/// The real Keychain.
final class SystemKeychain: KeychainCalls {
    func add(_ query: [String: Any]) -> OSStatus {
        SecItemAdd(query as CFDictionary, nil)
    }

    func copy(_ query: [String: Any]) -> (OSStatus, Data?) {
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        return (status, out as? Data)
    }

    func delete(_ query: [String: Any]) -> OSStatus {
        SecItemDelete(query as CFDictionary)
    }
}

final class KeychainSecretStore: SecretStore {
    static let service = "org.classbeat.player.pairing"
    static let account = "device"
    private static let probe = "probe"

    private let keychain: KeychainCalls

    init(keychain: KeychainCalls) {
        self.keychain = keychain
    }

    private static func item(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    /// The query that adds an item: passcode-bound, this device only, never synced.
    static func addQuery(_ account: String, _ data: Data) -> [String: Any] {
        var q = item(account)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        q[kSecAttrSynchronizable as String] = false
        q[kSecValueData as String] = data
        return q
    }

    /// Adds and deletes a throwaway item: true only when the Keychain takes the access class (it
    /// refuses it on a phone without a passcode).
    func available() -> Bool {
        let added = keychain.add(Self.addQuery(Self.probe, Data([0]))) == errSecSuccess
        _ = keychain.delete(Self.item(Self.probe))
        return added
    }

    func save(_ text: String) -> Bool {
        let data = Data(text.utf8)
        _ = keychain.delete(Self.item(Self.account))
        // Read back, so a save that did not land is a failure, not a token lost later.
        if keychain.add(Self.addQuery(Self.account, data)) == errSecSuccess, load() == text { return true }
        delete()
        return false
    }

    func load() -> String? {
        var q = Self.item(Self.account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, data) = keychain.copy(q)
        guard status == errSecSuccess, let data = data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete() {
        _ = keychain.delete(Self.item(Self.account))
    }

    /// Every class of Keychain item the app could have, synced or not.
    static let classes: [CFString] = [
        kSecClassGenericPassword, kSecClassInternetPassword, kSecClassCertificate, kSecClassKey, kSecClassIdentity,
    ]

    /// Deletes every Keychain item of the app, every class, synced or not. True only when each
    /// class is now empty; every class is tried even after one fails.
    static func deleteAll(_ keychain: KeychainCalls) -> Bool {
        var ok = true
        for c in classes {
            let q: [String: Any] = [kSecClass as String: c, kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
            let status = keychain.delete(q)
            if status != errSecSuccess && status != errSecItemNotFound { ok = false }
        }
        return ok
    }
}
