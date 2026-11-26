import UIKit
import WebKit
import Capacitor

// The one web view factory (issue #894, ADR 0016 section 2), the iOS twin of Android's
// BridgeLockdown. It holds the app's only `WKWebView(`, a test checks that, and applies every
// lock the issue asks for:
// - the bundle only: no server URL, no allowed navigation hosts, no error or start path,
//   Capacitor's scheme narrowed to the bundle (LockedSchemeHandler), navigation through
//   NavigationPolicy (LockedNavigation), browser links opened in Safari;
// - no plugin the shell does not know, and of those only the current mode's intents callable
//   (PluginPolicy, BridgeFilter), and only the current mode's pages shown (LockedNavigation);
// - web view inspection in a debug build only (BuildFlavor);
// - no media playback, AirPlay or picture in picture, no windows opened by script, no link
//   previews, no data detectors, no cookies.
// The page keeps the default persistent web storage: it remembers rider numbers there, as on
// Android.
enum WebViewFactory {
    /// Capacitor's settings: the bundled page at capacitor://localhost and nothing else.
    static func descriptor() -> InstanceDescriptor {
        let descriptor = InstanceDescriptor()
        descriptor.serverURL = nil
        descriptor.allowedNavigationHostnames = []
        descriptor.urlScheme = NavigationPolicy.scheme
        descriptor.urlHostname = NavigationPolicy.host
        descriptor.errorPath = nil
        descriptor.appStartPath = nil
        descriptor.isWebDebuggable = BuildFlavor.isDebug
        descriptor.allowLinkPreviews = false
        descriptor.limitsNavigationsToAppBoundDomains = false
        descriptor.handleApplicationNotifications = false
        return descriptor
    }

    /// A fresh, hardened web view configuration (Capacitor's own turns on inline media and AirPlay).
    static func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = false
        config.allowsAirPlayForMediaPlayback = false
        config.allowsPictureInPictureMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.dataDetectorTypes = []
        config.suppressesIncrementalRendering = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = true
        if #available(iOS 15.4, *) {
            config.preferences.isElementFullscreenEnabled = false
        }
        return config
    }

    /// The web view. Capacitor has already put its scheme handler and script handlers on
    /// `incoming`; a scheme cannot be registered twice, so the web view gets a fresh hardened
    /// configuration with Capacitor's handler wrapped in LockedSchemeHandler.
    static func make(frame: CGRect, configuration incoming: WKWebViewConfiguration) -> WKWebView {
        guard let capacitor = incoming.urlSchemeHandler(forURLScheme: NavigationPolicy.scheme) else {
            fatalError("classbeat: Capacitor's scheme handler is missing")
        }
        let config = configuration()
        config.userContentController = incoming.userContentController
        config.setURLSchemeHandler(LockedSchemeHandler(wrapping: capacitor), forURLScheme: NavigationPolicy.scheme)
        let webView = WKWebView(frame: frame, configuration: config)
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = BuildFlavor.isDebug
        }
        return webView
    }

    /// Keeps the navigation delegate alive: the web view holds its delegates weakly.
    private static var navigation: LockedNavigation?

    /// Locks the bridge once Capacitor has made it, and stops the app if it is not as expected.
    static func lock(_ webView: WKWebView, bridge: CapacitorBridge, gate: PageGate, exposed: @escaping () -> String?) {
        let config = bridge.config
        precondition(config.serverURL.absoluteString == NavigationPolicy.appOrigin, "classbeat: server URL")
        precondition(config.allowedNavigationHostnames.isEmpty, "classbeat: allowed navigation")
        precondition(config.isWebDebuggable == BuildFlavor.isDebug, "classbeat: web debugging")
        for plugin in ["CapacitorHttp", "CapacitorCookies"] {
            precondition(!config.getPluginConfig(plugin).getBoolean("enabled", true), "classbeat: \(plugin) is on")
        }
        guard let names = registeredPlugins(bridge) else {
            fatalError("classbeat: cannot read the bridge's plugins")
        }
        precondition(PluginPolicy.unknown(names).isEmpty, "classbeat: an unknown plugin is registered")
        precondition(PluginPolicy.core.isSubset(of: Set(names)), "classbeat: a core plugin is missing")
        precondition(PluginPolicy.callable.isSubset(of: Set(names)), "classbeat: a mode plugin is missing")

        let handler = bridge.webViewDelegationHandler
        let scripts = webView.configuration.userContentController
        scripts.removeScriptMessageHandler(forName: BridgeFilter.name)
        scripts.add(BridgeFilter(wrapping: handler, exposed: exposed), name: BridgeFilter.name)

        let locked = LockedNavigation(wrapping: handler, gate: gate)
        navigation = locked
        webView.navigationDelegate = locked
        webView.uiDelegate = locked
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = BuildFlavor.isDebug
        }
        HTTPCookieStorage.shared.cookieAcceptPolicy = .never
    }

    /// The names the bridge registered its plugins under. Capacitor keeps them in an internal
    /// table, so they are read by reflection; nil if the table is not where it is expected.
    static func registeredPlugins(_ bridge: CapacitorBridge) -> [String]? {
        for child in Mirror(reflecting: bridge).children where child.label == "plugins" {
            guard let table = child.value as? [String: Any] else { return nil }
            return Array(table.keys)
        }
        return nil
    }
}
