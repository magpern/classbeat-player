// Which kind of build this is (issue #894, ADR 0016 section 2). The project's Debug configuration
// compiles with DEBUG and its Release configuration does not; player/mobile/test/ios-project.test.ts
// checks both, so web view inspection (WebViewFactory) is on in a debug build only.
enum BuildFlavor {
    #if DEBUG
    static let isDebug = true
    #else
    static let isDebug = false
    #endif
}
