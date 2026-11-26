import WebKit

// The page's only way into Capacitor is the "bridge" script message handler. This filter stands
// in its place (issue #894) and passes on only a plugin call that PluginPolicy.admits: no Cordova
// call, no error report, no call to a core plugin. Today nothing is callable, so nothing passes.
final class BridgeFilter: NSObject, WKScriptMessageHandler {
    static let name = "bridge"
    private let inner: WKScriptMessageHandler

    init(wrapping inner: WKScriptMessageHandler) {
        self.inner = inner
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard PluginPolicy.admits(message.body) else { return }
        inner.userContentController(userContentController, didReceive: message)
    }
}
