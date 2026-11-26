import UIKit
import WebKit
import Capacitor

// The web view's navigation and UI delegate (issue #894), in place of Capacitor's own. Every
// navigation goes through NavigationPolicy: the bundle loads, a tapped https link opens in Safari,
// the rest is cancelled. The page gets no new windows, no camera or microphone, no device
// orientation, and no JavaScript panels (Capacitor answers its cookie and HTTP plugins through
// the prompt panel). The page-load events still reach Capacitor, which resets its bridge on them.
final class LockedNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let inner: WebViewDelegationHandler

    init(wrapping inner: WebViewDelegationHandler) {
        self.inner = inner
        super.init()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let target = navigationAction.targetFrame
        let url = navigationAction.request.url?.absoluteString ?? ""
        let decision = NavigationPolicy.navigate(
            url,
            mainFrame: target?.isMainFrame ?? true,
            userGesture: navigationAction.navigationType == .linkActivated
        )
        switch decision {
        case .load where target != nil:
            decisionHandler(.allow)
        case .browser:
            if let link = navigationAction.request.url {
                UIApplication.shared.open(link, options: [:], completionHandler: nil)
            }
            decisionHandler(.cancel)
        default:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        inner.webView(webView, didStartProvisionalNavigation: navigation)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        inner.webView(webView, didFinish: navigation)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        inner.webView(webView, didFail: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        inner.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        inner.webViewWebContentProcessDidTerminate(webView)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }

    func webView(
        _ webView: WKWebView,
        requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(false)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        completionHandler(nil)
    }
}
