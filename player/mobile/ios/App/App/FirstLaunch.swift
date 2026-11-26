import Foundation

// The first launch after an install (issue #896, ADR 0016 section 4). Keychain items outlive an
// uninstall, so a token from an earlier install would pair a phone nobody paired. Before anything
// reads the Keychain: with no marker in UserDefaults (which an uninstall does delete), every
// Keychain item of the app is deleted, then the marker is written. The app then starts unpaired,
// in rider mode.
enum FirstLaunch {
    static let markerKey = "classbeat.firstLaunchDone"

    /// True when the Keychain may be read: the marker was there, or the wipe and the marker both
    /// held. On false nothing is marked, so the next launch tries again.
    static func run(_ defaults: UserDefaults, wipe: () -> Bool) -> Bool {
        if defaults.bool(forKey: markerKey) { return true }
        if !wipe() { return false }
        defaults.set(true, forKey: markerKey)
        return defaults.bool(forKey: markerKey)
    }

    /// The pairing store for this launch: the Keychain after the first-launch check, or a closed
    /// store (unpaired, cannot pair) when the wipe did not hold.
    static func store(defaults: UserDefaults, keychain: KeychainCalls) -> SecretStore {
        let ready = run(defaults) { KeychainSecretStore.deleteAll(keychain) }
        return ready ? KeychainSecretStore(keychain: keychain) : ClosedSecretStore()
    }
}
