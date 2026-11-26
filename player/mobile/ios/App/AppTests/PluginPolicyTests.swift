import XCTest
@testable import App

final class PluginPolicyTests: XCTestCase {
    func testTheCorePluginsOfThePinnedCapacitorAreKnownAndOnlyTheModePluginsAreCallable() {
        XCTAssertEqual(PluginPolicy.core, ["CapacitorHttp", "Console", "WebView", "CapacitorCookies", "SystemBars"])
        XCTAssertEqual(PluginPolicy.callable, ["RiderMode", "InstructorMode"])
        XCTAssertTrue(PluginPolicy.core.isDisjoint(with: PluginPolicy.callable))
        XCTAssertEqual(PluginPolicy.known, PluginPolicy.core.union(PluginPolicy.callable))
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
            for exposed in [nil, "RiderMode", "InstructorMode", "WebView", "Console"] as [String?] {
                XCTAssertFalse(PluginPolicy.admits(message, exposed: exposed), "\(message) \(String(describing: exposed))")
            }
        }
    }

    private func call(_ plugin: String, _ method: String, type: String = "message") -> [String: Any] {
        ["type": type, "pluginId": plugin, "methodName": method, "callbackId": "1", "options": [:]]
    }

    func testOnlyTheExposedModePluginsIntentsReachCapacitor() {
        XCTAssertTrue(PluginPolicy.admits(call("RiderMode", "askInstructorMode"), exposed: "RiderMode"))
        XCTAssertTrue(PluginPolicy.admits(call("InstructorMode", "follow"), exposed: "InstructorMode"))
        // Nothing is on the bridge between modes.
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "askInstructorMode"), exposed: nil))
        // The other mode's plugin, or the other mode's intent on this one.
        XCTAssertFalse(PluginPolicy.admits(call("InstructorMode", "follow"), exposed: "RiderMode"))
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "follow"), exposed: "RiderMode"))
        XCTAssertFalse(PluginPolicy.admits(call("InstructorMode", "join"), exposed: "InstructorMode"))
        // Listeners, unknown methods and other message types.
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "addListener"), exposed: "RiderMode"))
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "removeAllListeners"), exposed: "RiderMode"))
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "nope"), exposed: "RiderMode"))
        XCTAssertFalse(PluginPolicy.admits(call("RiderMode", "leave", type: "cordova"), exposed: "RiderMode"))
        // A core plugin is never callable, even if named as exposed.
        XCTAssertFalse(PluginPolicy.admits(call("WebView", "setServerBasePath"), exposed: "WebView"))
        var noMethod = call("RiderMode", "leave")
        noMethod["methodName"] = nil
        XCTAssertFalse(PluginPolicy.admits(noMethod, exposed: "RiderMode"))
    }
}
