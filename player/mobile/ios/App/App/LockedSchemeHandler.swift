import Foundation
import WebKit

// Capacitor's handler for capacitor://, narrowed to the bundle (issue #894). Capacitor serves
// device files under /_capacitor_file_ and proxies remote requests under
// /_capacitor_http_interceptor_; this wrapper passes on only what NavigationPolicy.serves allows
// and fails every other request before Capacitor sees it.
final class LockedSchemeHandler: NSObject, WKURLSchemeHandler {
    private let inner: WKURLSchemeHandler

    init(wrapping inner: WKURLSchemeHandler) {
        self.inner = inner
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, NavigationPolicy.serves(url.absoluteString) else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        inner.webView(webView, start: urlSchemeTask)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        inner.webView(webView, stop: urlSchemeTask)
    }
}
