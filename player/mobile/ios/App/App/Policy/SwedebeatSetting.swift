// The iOS build's one Swedebeat setting (issue #932), off. With it off nothing in the app signs in to
// that service, fetches from it or caches its audio, and the page shows the option dimmed.
// build-config.mjs reads the line below into the page bundle, so native code and the page cannot
// disagree; player/mobile/test/ios-swedebeat.test.ts keeps them in step and fails if the build turns
// the service on without this line changing.
enum SwedebeatSetting {
    static let swedebeatEnabled = false
}
