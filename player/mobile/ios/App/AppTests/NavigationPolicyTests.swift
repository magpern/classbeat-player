import XCTest
@testable import App

// The same table as Android's NavigationPolicyTest.kt, at capacitor://localhost (issue #894).
final class NavigationPolicyTests: XCTestCase {
    private let bundled = [
        "capacitor://localhost/",
        "capacitor://localhost",
        "capacitor://localhost/index.html",
        "capacitor://localhost/main.js",
        "capacitor://localhost/fonts/a.woff2",
        "capacitor://localhost/index.html?x=1#top",
        "capacitor://localhost/fonts/a%20b.woff2",
        "capacitor://localhost/fonts/",
        "capacitor://localhost/my_capacitor_notes.js",
    ]

    private let notBundled = [
        "https://localhost/",
        "http://localhost/",
        "capacitor://localhost:8443/",
        "capacitor://user@localhost/",
        "capacitor://localhost.example.com/",
        "https://example.com/",
        "https://LOCALHOST.evil/",
        "capacitor://localhost/_capacitor_file_/var/mobile/x",
        "capacitor://localhost/_capacitor_content_/x",
        "capacitor://localhost/_capacitor_http_interceptor_?u=https://example.com",
        "capacitor://localhost/a/../_capacitor_file_/x",
        "capacitor://localhost/%2e%2e/x",
        // Capacitor's scheme handler matches its prefixes on the decoded path.
        "capacitor://localhost/%5Fcapacitor_file_/var/mobile/x",
        "capacitor://localhost/%5fcapacitor_file_/x",
        "capacitor://localhost/_%63apacitor_content_/x",
        "capacitor://localhost/%5F%63%61%70%61%63%69%74%6F%72_http_interceptor_",
        "capacitor://localhost/%255Fcapacitor_file_/x",
        "capacitor://localhost/%25%35%46capacitor_file_/x",
        "capacitor://localhost/_CAPACITOR_FILE_/x",
        "capacitor://localhost/_Capacitor_file_/x",
        "capacitor://localhost/fonts/_capacitor_file_/x",
        "capacitor://localhost//_capacitor_file_/x",
        "capacitor://localhost/fonts//a.woff2",
        "capacitor://localhost/a/../index.html",
        "capacitor://localhost/./index.html",
        "capacitor://localhost/a/%2E%2E/_capacitor_file_/x",
        "capacitor://localhost/a/.%2e/x",
        "capacitor://localhost/a%2f..%2f_capacitor_file_/x",
        "capacitor://localhost/a%5c..%5c_capacitor_file_/x",
        "capacitor://localhost/a%00.html",
        "capacitor://localhost/%C0%AF",
        "capacitor://localhost/%FF",
        "file:///var/mobile/public/index.html",
        "data:text/html,<p>x",
        "blob:capacitor://localhost/1234",
        "javascript:alert(1)",
        "about:blank",
        "tel:123",
        "ws://localhost/",
        "not a url",
        "",
    ]

    func testThePathIsDecodedStrictlyAndABadEscapeFailsClosed() {
        XCTAssertEqual(NavigationPolicy.decodePath("/%5Fcapacitor_file_/x"), "/_capacitor_file_/x")
        XCTAssertEqual(NavigationPolicy.decodePath("/%255F"), "/%5F")
        XCTAssertEqual(NavigationPolicy.decodePath("/a%20b/%C3%A9"), "/a b/\u{e9}")
        for bad in ["/%", "/%5", "/%zz", "/%5G", "/%C0%AF", "/%FF", "/%C3"] {
            XCTAssertNil(NavigationPolicy.decodePath(bad), bad)
        }
    }

    func testOnlyTheBundleIsServed() {
        for url in bundled { XCTAssertTrue(NavigationPolicy.serves(url), url) }
        for url in notBundled { XCTAssertFalse(NavigationPolicy.serves(url), url) }
    }

    func testTheBundleLoadsInTheMainFrameOnly() {
        for url in bundled {
            XCTAssertEqual(NavigationPolicy.navigate(url, mainFrame: true, userGesture: false), .load, url)
            XCTAssertEqual(NavigationPolicy.navigate(url, mainFrame: false, userGesture: true), .refuse, url)
        }
    }

    func testATappedHttpsLinkToASiteOpensInTheBrowser() {
        for url in ["https://example.com/", "https://classbeat.example/help?a=1"] {
            XCTAssertEqual(NavigationPolicy.navigate(url, mainFrame: true, userGesture: true), .browser, url)
        }
    }

    func testWithoutATapInAFrameOrOfAnotherKindALinkIsRefused() {
        let site = "https://example.com/"
        XCTAssertEqual(NavigationPolicy.navigate(site, mainFrame: true, userGesture: false), .refuse)
        XCTAssertEqual(NavigationPolicy.navigate(site, mainFrame: false, userGesture: true), .refuse)
        let sites: Set<String> = ["https://example.com/", "https://LOCALHOST.evil/"]
        for url in notBundled where !sites.contains(url) {
            XCTAssertEqual(NavigationPolicy.navigate(url, mainFrame: true, userGesture: true), .refuse, url)
        }
        XCTAssertEqual(NavigationPolicy.navigate("https://user:pw@example.com/", mainFrame: true, userGesture: true), .refuse)
    }
}
