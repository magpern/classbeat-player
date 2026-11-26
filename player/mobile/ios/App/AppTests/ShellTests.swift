import XCTest
import UIKit
import WebKit
import Capacitor
@testable import App

// The running shell, as the hosted test app launched it (issue #894).
final class ShellTests: XCTestCase {
    private func shell() throws -> ShellViewController {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let roots = scenes.flatMap { $0.windows }.compactMap { $0.rootViewController as? ShellViewController }
            if let shell = roots.first, shell.webView != nil, shell.bridge != nil { return shell }
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        throw ShellMissing()
    }

    func testTheWebViewIsHardened() throws {
        let webView = try XCTUnwrap(try shell().webView)
        let config = webView.configuration
        XCTAssertFalse(config.allowsInlineMediaPlayback)
        XCTAssertFalse(config.allowsAirPlayForMediaPlayback)
        XCTAssertFalse(config.allowsPictureInPictureMediaPlayback)
        XCTAssertEqual(config.mediaTypesRequiringUserActionForPlayback, .all)
        XCTAssertFalse(config.preferences.javaScriptCanOpenWindowsAutomatically)
        XCTAssertFalse(webView.allowsLinkPreview)
        XCTAssertTrue(config.urlSchemeHandler(forURLScheme: "capacitor") is LockedSchemeHandler)
        XCTAssertTrue(webView.navigationDelegate is LockedNavigation)
        XCTAssertTrue(webView.uiDelegate is LockedNavigation)
        if #available(iOS 16.4, *) {
            XCTAssertEqual(webView.isInspectable, BuildFlavor.isDebug)
        }
        XCTAssertEqual(HTTPCookieStorage.shared.cookieAcceptPolicy, .never)
    }

    func testTheBridgeServesTheBundleOnlyWithItsCorePluginsOff() throws {
        let bridge = try XCTUnwrap(try shell().bridge as? CapacitorBridge)
        XCTAssertEqual(bridge.config.serverURL.absoluteString, NavigationPolicy.appOrigin)
        XCTAssertEqual(bridge.config.allowedNavigationHostnames, [])
        XCTAssertEqual(bridge.config.isWebDebuggable, BuildFlavor.isDebug)
        XCTAssertFalse(bridge.config.getPluginConfig("CapacitorHttp").getBoolean("enabled", true))
        XCTAssertFalse(bridge.config.getPluginConfig("CapacitorCookies").getBoolean("enabled", true))
        let names = try XCTUnwrap(WebViewFactory.registeredPlugins(bridge))
        XCTAssertEqual(Set(names), PluginPolicy.core)
    }

    func testTheSchemeHandlerServesTheBundleOnly() throws {
        let webView = try XCTUnwrap(try shell().webView)
        let inner = RecordingHandler()
        let locked = LockedSchemeHandler(wrapping: inner)
        for url in ["capacitor://localhost/_capacitor_file_/var/mobile/x", "capacitor://localhost/%5Fcapacitor_http_interceptor_"] {
            let task = FakeTask(url)
            locked.webView(webView, start: task)
            XCTAssertTrue(task.failed, url)
        }
        XCTAssertEqual(inner.started, 0)
        let task = FakeTask("capacitor://localhost/index.html")
        locked.webView(webView, start: task)
        XCTAssertFalse(task.failed)
        XCTAssertEqual(inner.started, 1)
    }

    func testANavigationAwayFromTheBundleIsCancelled() throws {
        let webView = try XCTUnwrap(try shell().webView)
        let navigation = try XCTUnwrap(webView.navigationDelegate as? LockedNavigation)
        let cases: [(String, Bool?, WKNavigationType, WKNavigationActionPolicy)] = [
            ("capacitor://localhost/index.html", true, .other, .allow),
            ("capacitor://localhost/index.html", false, .other, .cancel),
            ("capacitor://localhost/index.html", nil, .linkActivated, .cancel),
            ("capacitor://localhost/_capacitor_file_/x", true, .other, .cancel),
            ("https://example.com/", true, .other, .cancel),
            ("https://example.com/", false, .linkActivated, .cancel),
            ("http://example.com/", true, .linkActivated, .cancel),
            ("tel:123", true, .linkActivated, .cancel),
        ]
        for (url, mainFrame, type, expected) in cases {
            var decided: WKNavigationActionPolicy?
            let action = FakeAction(url, mainFrame: mainFrame, type: type)
            navigation.webView(webView, decidePolicyFor: action) { decided = $0 }
            XCTAssertEqual(decided, expected, url)
        }
    }

    func testThePageGetsNoNewWindow() throws {
        let webView = try XCTUnwrap(try shell().webView)
        let delegate = try XCTUnwrap(webView.uiDelegate)
        let action = FakeAction("https://example.com/", mainFrame: nil, type: .linkActivated)
        let made = delegate.webView?(webView, createWebViewWith: WKWebViewConfiguration(), for: action, windowFeatures: WKWindowFeatures())
        XCTAssertNil(made)
    }
}

private struct ShellMissing: Error {}

private final class RecordingHandler: NSObject, WKURLSchemeHandler {
    var started = 0
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) { started += 1 }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

private final class FakeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    var failed = false
    init(_ url: String) { request = URLRequest(url: URL(string: url)!) }
    func didReceive(_ response: URLResponse) {}
    func didReceive(_ data: Data) {}
    func didFinish() {}
    func didFailWithError(_ error: Error) { failed = true }
}

private final class FakeFrame: WKFrameInfo {
    private let main: Bool
    init(main: Bool) { self.main = main; super.init() }
    override var isMainFrame: Bool { main }
}

private final class FakeAction: WKNavigationAction {
    private let fakeRequest: URLRequest
    private let frame: WKFrameInfo?
    private let type: WKNavigationType
    init(_ url: String, mainFrame: Bool?, type: WKNavigationType) {
        fakeRequest = URLRequest(url: URL(string: url)!)
        frame = mainFrame.map { FakeFrame(main: $0) }
        self.type = type
        super.init()
    }
    override var request: URLRequest { fakeRequest }
    override var targetFrame: WKFrameInfo? { frame }
    override var navigationType: WKNavigationType { type }
}
