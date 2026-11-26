import Foundation

// Which Capacitor plugins may be on the bridge, and which the page may call (issue #894, ADR 0016
// section 2). Pure: no UIKit, WebKit or Capacitor import.
//
// Capacitor 8.6.0's iOS bridge registers five plugins of its own in every bridge
// (CapacitorBridge.registerPlugins): CapacitorHttp, Console, WebView, CapacitorCookies and
// SystemBars. Their table is internal to Capacitor, so none can be removed; each is disabled
// instead. The page reaches a plugin only through the "bridge" script message handler, which
// BridgeFilter replaces: it passes on only a call to an intent of the one mode plugin on the
// bridge now (issue #895), and drops listener calls, Cordova calls and everything else. CapacitorHttp and CapacitorCookies are also switched off in
// capacitor.config.json, and the shell answers no prompt panel, their other way in.
// player/mobile/test/ios-plugins.test.ts reads the pinned Capacitor's sources and fails if this
// list differs from what it registers.
enum PluginPolicy {
    /// Capacitor 8.6.0's own iOS plugins, by the name the bridge registers them under.
    static let core: Set<String> = ["CapacitorHttp", "Console", "WebView", "CapacitorCookies", "SystemBars"]

    /// The plugins the page may call: the two mode plugins (issue #895), one at a time.
    static let callable: Set<String> = ["RiderMode", "InstructorMode"]

    /// Every name the shell knows; any other name on the bridge stops the app.
    static let known: Set<String> = core.union(callable)

    /// The names on the bridge the shell does not know, sorted; empty when the bridge is as expected.
    static func unknown<Names: Sequence>(_ names: Names) -> [String] where Names.Element == String {
        names.filter { !known.contains($0) }.sorted()
    }

    /// True for a message from the page that may reach Capacitor: a plugin call to `exposed`, the
    /// one mode plugin on the bridge now, naming one of that mode's intents. Listener calls, which
    /// Capacitor would otherwise take for any plugin, are no intent and never pass.
    static func admits(_ body: Any, exposed: String?) -> Bool {
        guard let exposed = exposed, callable.contains(exposed),
              let mode = Mode.allCases.first(where: { $0.plugin == exposed }),
              let message = body as? [String: Any],
              message["type"] as? String == "message",
              message["pluginId"] as? String == exposed,
              let method = message["methodName"] as? String else { return false }
        return IntentPolicy.of(mode).contains(method)
    }
}
