import Foundation
import WebKit

// The external display web view's navigation and UI delegate (issue #897), the iOS side of
// Android's locked chrome client and loader rule for the presentation. Every load goes through
// ExternalDisplayPolicy.mayLoad: in the main frame an idle page of the bundle and nothing else, in
// an inner frame a bundle file. No link or form is followed, no window opens, no camera,
// microphone or device orientation is granted, and JavaScript panels get their default answers.
// There is no bridge to reach: the web view has no script message handler (WebViewFactory.makeDisplay).
final class DisplayNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let crashed: () -> Void

    /// `crashed` hears, on the next main-queue turn, that the web view's content process died.
    init(crashed: @escaping () -> Void) {
        self.crashed = crashed
        super.init()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let target = navigationAction.targetFrame else {
            decisionHandler(.cancel)
            return
        }
        switch navigationAction.navigationType {
        case .linkActivated, .formSubmitted, .formResubmitted:
            decisionHandler(.cancel)
            return
        default:
            break
        }
        let url = navigationAction.request.url?.absoluteString ?? ""
        decisionHandler(ExternalDisplayPolicy.mayLoad(url, mainFrame: target.isMainFrame) ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Not from inside WebKit's callback: the presenter takes this web view down and makes another.
        let crashed = self.crashed
        DispatchQueue.main.async(execute: crashed)
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
