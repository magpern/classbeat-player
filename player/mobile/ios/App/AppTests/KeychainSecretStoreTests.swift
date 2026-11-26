import XCTest
import Security
@testable import App

// The Keychain store (issue #896): a generic password bound to the passcode, on this device only,
// never synced; a Keychain that refuses means no pairing and nothing kept anywhere else.
final class KeychainSecretStoreTests: XCTestCase {
    private let text = PairingRecord(origin: FakeBackend.origin, token: Secrets.token(), email: nil).text()!

    func testTheTokenIsAGenericPasswordOnlyWhilePasscodeSetOnThisDevice() {
        let keychain = FakeKeychain()
        XCTAssertTrue(KeychainSecretStore(keychain: keychain).save(text))
        XCTAssertFalse(keychain.added.isEmpty)
        for q in keychain.added {
            XCTAssertEqual(q[kSecClass as String] as? String, kSecClassGenericPassword as String)
            XCTAssertEqual(q[kSecAttrAccessible as String] as? String, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String)
            XCTAssertEqual(q[kSecAttrSynchronizable as String] as? Bool, false)
            XCTAssertEqual(q[kSecAttrService as String] as? String, KeychainSecretStore.service)
        }
    }

    func testTheRecordRoundTrips() {
        let keychain = FakeKeychain()
        let store = KeychainSecretStore(keychain: keychain)
        XCTAssertNil(store.load())
        XCTAssertTrue(store.save(text))
        XCTAssertEqual(store.load(), text)
        XCTAssertTrue(store.save(text))
        XCTAssertEqual(store.load(), text)
        store.delete()
        XCTAssertNil(store.load())
        XCTAssertTrue(keychain.items.isEmpty)
    }

    func testARefusingKeychainMeansNoPairingAndNothingKept() {
        let keychain = FakeKeychain()
        keychain.addStatus = errSecInteractionNotAllowed
        let store = KeychainSecretStore(keychain: keychain)
        XCTAssertFalse(store.available())
        XCTAssertFalse(store.save(text))
        XCTAssertNil(store.load())
        XCTAssertTrue(keychain.items.isEmpty)

        // Through the service: no start call, so no token to keep.
        let rig = PairingRig(store: store)
        rig.service.begin()
        XCTAssertEqual(rig.backend.requests.count, 0)
        XCTAssertEqual(rig.service.view(), .unpaired(notice: .noKeychain))
        XCTAssertTrue(keychain.items.isEmpty)
    }

    func testAvailableLeavesNoProbeBehind() {
        let keychain = FakeKeychain()
        XCTAssertTrue(KeychainSecretStore(keychain: keychain).available())
        XCTAssertTrue(keychain.items.isEmpty)
        XCTAssertEqual(keychain.added.first?[kSecAttrAccessible as String] as? String, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String)
    }

    func testDeleteAllTriesEveryClassSyncedOrNot() {
        let keychain = FakeKeychain()
        keychain.items = ["device": Data(text.utf8)]
        XCTAssertTrue(KeychainSecretStore.deleteAll(keychain))
        XCTAssertTrue(keychain.items.isEmpty)
        let classes = keychain.deleted.compactMap { $0[kSecClass as String] as? String }
        XCTAssertEqual(Set(classes), Set([
            kSecClassGenericPassword, kSecClassInternetPassword, kSecClassCertificate, kSecClassKey, kSecClassIdentity,
        ].map { $0 as String }))
        for q in keychain.deleted {
            XCTAssertEqual(q[kSecAttrSynchronizable as String] as? String, kSecAttrSynchronizableAny as String)
            XCTAssertNil(q[kSecAttrAccount as String])
        }
    }

    func testDeleteAllFailsWhenAClassCannotBeEmptiedButTriesThemAll() {
        let keychain = FakeKeychain()
        keychain.deleteStatus = errSecInteractionNotAllowed
        XCTAssertFalse(KeychainSecretStore.deleteAll(keychain))
        XCTAssertEqual(keychain.deleted.count, 5)
    }

    /// The real Keychain: an item of the app is gone after deleteAll. The simulator without a
    /// signed host has no Keychain entitlement (-34018); the test is skipped there, never passed.
    func testDeleteAllEmptiesTheRealKeychain() throws {
        let keychain = SystemKeychain()
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "org.classbeat.player.test",
            kSecAttrAccount as String: "wipe",
            kSecValueData as String: Data("x".utf8),
        ]
        let status = keychain.add(item)
        if status == errSecMissingEntitlement { throw XCTSkip("no Keychain entitlement on this simulator") }
        XCTAssertTrue(status == errSecSuccess || status == errSecDuplicateItem, "add: \(status)")
        XCTAssertTrue(KeychainSecretStore.deleteAll(keychain))
        let found = keychain.copy([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "org.classbeat.player.test",
            kSecAttrAccount as String: "wipe",
            kSecReturnData as String: true,
        ])
        XCTAssertEqual(found.0, errSecItemNotFound)
    }
}
