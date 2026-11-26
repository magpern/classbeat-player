import XCTest
@testable import App

final class PluginPolicyTests: XCTestCase {
    func testTheCorePluginsOfThePinnedCapacitorAreKnownAndNoneIsCallable() {
        XCTAssertEqual(PluginPolicy.core, ["CapacitorHttp", "Console", "WebView", "CapacitorCookies", "SystemBars"])
        XCTAssertTrue(PluginPolicy.callable.isEmpty)
        XCTAssertEqual(PluginPolicy.known, PluginPolicy.core)
    }

    func testAnUnknownNameIsReported() {
        XCTAssertEqual(PluginPolicy.unknown(["Console", "WebView"]), [])
        XCTAssertEqual(PluginPolicy.unknown(["Console", "Filesystem", "Camera"]), ["Camera", "Filesystem"])
    }

    func testNoMessageFromThePageReachesCapacitor() {
        let messages: [Any] = [
            ["type": "message", "pluginId": "WebView", "methodName": "setServerBasePath", "callbackId": "1", "options": [:]],
            ["type": "message", "pluginId": "CapacitorHttp", "methodName": "request", "callbackId": "2", "options": [:]],
            ["type": "message", "pluginId": "Console", "methodName": "log", "callbackId": "3", "options": [:]],
            ["type": "cordova", "service": "File", "action": "read"],
            ["type": "js.error", "error": ["message": "x"]],
            ["type": "message"],
            "message",
            42,
        ]
        for message in messages {
            XCTAssertFalse(PluginPolicy.admits(message), "\(message)")
        }
    }
}
