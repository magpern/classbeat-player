import WebKit

// The page's only way into Capacitor is the "bridge" script message handler. This filter stands
// in its place (issue #894) and passes on only a plugin call that PluginPolicy.admits: no Cordova
// call, no error report, no call to a core plugin, and of the mode plugins only an intent of the one
// `exposed` names now (issue #895). ModeController checks each call again when it runs.
final class BridgeFilter: NSObject, WKScriptMessageHandler {
    static let name = "bridge"
    private let inner: WKScriptMessageHandler
    private let exposed: () -> String?

    init(wrapping inner: WKScriptMessageHandler, exposed: @escaping () -> String?) {
        self.inner = inner
        self.exposed = exposed
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard PluginPolicy.admits(message.body, exposed: exposed()) else { return }
        inner.userContentController(userContentController, didReceive: message)
    }
}
