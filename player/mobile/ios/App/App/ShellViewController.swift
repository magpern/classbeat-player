import UIKit
import WebKit
import Capacitor

// The shell (issue #894, ADR 0016 section 2): Capacitor's bridge view controller with every
// setting it reads taken from WebViewFactory, the one place that makes and locks the web view.
final class ShellViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        WebViewFactory.descriptor()
    }

    override func router() -> Router {
        CapacitorRouter()
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        WebViewFactory.configuration()
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        WebViewFactory.make(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        // Fail closed: a shell that cannot be locked does not run.
        guard let webView = webView, let bridge = bridge as? CapacitorBridge else {
            fatalError("classbeat: the web view or the bridge is missing")
        }
        WebViewFactory.lock(webView, bridge: bridge)
    }
}
