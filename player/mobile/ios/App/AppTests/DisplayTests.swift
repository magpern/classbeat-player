import XCTest
import WebKit
@testable import App

// The external display's web view as the factory makes it, and its delegate (issue #897): no
// bridge, no script, no stored data, the bundle only, and in its main frame an idle page only.
final class DisplayTests: XCTestCase {
    private func wait(_ done: () -> Bool) {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline, !done() {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
    }

    func testTheDisplaysWebViewIsHardenedAndHasNothingOfThePhones() {
        let webView = WebViewFactory.makeDisplay(frame: .zero)
        let config = webView.configuration
        XCTAssertTrue(config.userContentController.userScripts.isEmpty)
        XCTAssertFalse(config.websiteDataStore.isPersistent)
        XCTAssertTrue(config.urlSchemeHandler(forURLScheme: NavigationPolicy.scheme) is LockedSchemeHandler)
        XCTAssertFalse(config.allowsInlineMediaPlayback)
        XCTAssertFalse(config.allowsAirPlayForMediaPlayback)
        XCTAssertFalse(config.allowsPictureInPictureMediaPlayback)
        XCTAssertEqual(config.mediaTypesRequiringUserActionForPlayback, .all)
        XCTAssertFalse(config.preferences.javaScriptCanOpenWindowsAutomatically)
        XCTAssertFalse(webView.allowsLinkPreview)
        if #available(iOS 16.4, *) {
            XCTAssertEqual(webView.isInspectable, BuildFlavor.isDebug)
        }
        // Each call makes its own: nothing is shared with another web view.
        let other = WebViewFactory.makeDisplay(frame: .zero)
        XCTAssertFalse(other === webView)
        XCTAssertFalse(other.configuration.userContentController === config.userContentController)
    }

    /// Loads the idle page into `webView` and waits for it.
    private func loadIdlePage(_ webView: WKWebView) throws {
        webView.load(URLRequest(url: try XCTUnwrap(URL(string: NavigationPolicy.appOrigin + ExternalDisplayPolicy.idlePage))))
        wait { webView.url?.path == ExternalDisplayPolicy.idlePage && !webView.isLoading }
        XCTAssertEqual(webView.url?.path, ExternalDisplayPolicy.idlePage)
    }

    /// The string a script in the page gives back, or nil. (The content-world variant comes from
    /// WebKit's Swift overlay, which the simulator's test host cannot load.)
    private func evaluate(_ webView: WKWebView, _ script: String) -> String? {
        var answer: String?
        var done = false
        webView.evaluateJavaScript(script) { value, _ in
            answer = value as? String
            done = true
        }
        wait { done }
        return answer
    }

    // WebKit puts `window.webkit` in the page only while a script message handler of any name is
    // registered for it, so `typeof window.webkit` is "undefined" exactly when the page has no
    // handler to post to, whatever it would be called. The next test shows the probe sees a
    // handler of a name nobody could guess. A handler in another content world is kept out by the
    // node guard (test/ios-rules.test.ts): only the factory's lock puts one on.
    private static let probe = """
    [typeof window.Capacitor,
     typeof window.webkit,
     typeof window.androidBridge,
     document.body ? "body" : "none"].join(",")
    """

    func testTheIdlePageLoadsWithNoScriptMessageHandlerOfAnyNameAndNoPluginToCall() throws {
        let webView = WebViewFactory.makeDisplay(frame: .zero)
        let navigation = DisplayNavigation(crashed: {})
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation
        try loadIdlePage(webView)
        XCTAssertEqual(evaluate(webView, Self.probe), "undefined,undefined,undefined,body")
        withExtendedLifetime(navigation) {}
    }

    func testTheProbeSeesAScriptMessageHandlerOfAnyName() throws {
        let webView = WebViewFactory.makeDisplay(frame: .zero)
        let navigation = DisplayNavigation(crashed: {})
        webView.navigationDelegate = navigation
        let name = "h" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        webView.configuration.userContentController.add(IgnoredMessages(), name: name)
        try loadIdlePage(webView)
        XCTAssertEqual(evaluate(webView, Self.probe), "undefined,object,undefined,body", name)
        withExtendedLifetime(navigation) {}
    }

    func testEveryNavigationIsDecidedByThePolicyAndNoLinkOrFormIsFollowed() {
        let webView = WebViewFactory.makeDisplay(frame: .zero)
        let navigation = DisplayNavigation(crashed: {})
        let base = NavigationPolicy.appOrigin
        let cases: [(String, Bool?, WKNavigationType, WKNavigationActionPolicy)] = [
            ("\(base)/display.html", true, .other, .allow),
            ("\(base)/display-rider.html", true, .reload, .allow),
            ("\(base)/main.js", false, .other, .allow),
            ("\(base)/display.html", nil, .other, .cancel),
            ("\(base)/display.html", true, .linkActivated, .cancel),
            ("\(base)/display.html", true, .formSubmitted, .cancel),
            ("\(base)/display.html", true, .formResubmitted, .cancel),
            ("\(base)/room.html", true, .other, .cancel),
            ("\(base)/instructor.html", true, .other, .cancel),
            ("\(base)/rider.html", true, .backForward, .cancel),
            ("\(base)/index.html", true, .other, .cancel),
            ("\(base)/_capacitor_file_/x", false, .other, .cancel),
            ("https://example.com/display.html", true, .other, .cancel),
            ("https://example.com/", false, .other, .cancel),
        ]
        for (url, mainFrame, type, expected) in cases {
            var decided: WKNavigationActionPolicy?
            let action = DisplayAction(url, mainFrame: mainFrame, type: type)
            navigation.webView(webView, decidePolicyFor: action) { decided = $0 }
            XCTAssertEqual(decided, expected, "\(url) \(String(describing: mainFrame)) \(type.rawValue)")
        }
    }

    func testTheDisplayOpensNoWindowAndAnswersEveryPanelWithItsDefault() {
        let webView = WebViewFactory.makeDisplay(frame: .zero)
        let navigation = DisplayNavigation(crashed: {})
        let action = DisplayAction("https://example.com/", mainFrame: nil, type: .linkActivated)
        XCTAssertNil(navigation.webView(webView, createWebViewWith: WKWebViewConfiguration(), for: action, windowFeatures: WKWindowFeatures()))
        let frame = DisplayFrame(main: true)
        var confirmed: Bool?
        navigation.webView(webView, runJavaScriptConfirmPanelWithMessage: "x", initiatedByFrame: frame) { confirmed = $0 }
        XCTAssertEqual(confirmed, false)
        var typed: String?? = .some("x")
        navigation.webView(webView, runJavaScriptTextInputPanelWithPrompt: "x", defaultText: "y", initiatedByFrame: frame) { typed = .some($0) }
        XCTAssertEqual(typed, .some(nil))
        var alerted = false
        navigation.webView(webView, runJavaScriptAlertPanelWithMessage: "x", initiatedByFrame: frame) { alerted = true }
        XCTAssertTrue(alerted)
    }

    func testADeadContentProcessIsReportedOnTheNextMainQueueTurn() {
        var crashed = 0
        let navigation = DisplayNavigation(crashed: { crashed += 1 })
        navigation.webViewWebContentProcessDidTerminate(WebViewFactory.makeDisplay(frame: .zero))
        XCTAssertEqual(crashed, 0)
        wait { crashed > 0 }
        XCTAssertEqual(crashed, 1)
    }
}

private final class IgnoredMessages: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {}
}

private final class DisplayFrame: WKFrameInfo {
    private let main: Bool
    init(main: Bool) { self.main = main; super.init() }
    override var isMainFrame: Bool { main }
}

private final class DisplayAction: WKNavigationAction {
    private let fakeRequest: URLRequest
    private let frame: WKFrameInfo?
    private let type: WKNavigationType
    init(_ url: String, mainFrame: Bool?, type: WKNavigationType) {
        fakeRequest = URLRequest(url: URL(string: url)!)
        frame = mainFrame.map { DisplayFrame(main: $0) }
        self.type = type
        super.init()
    }
    override var request: URLRequest { fakeRequest }
    override var targetFrame: WKFrameInfo? { frame }
    override var navigationType: WKNavigationType { type }
}
