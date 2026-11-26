import XCTest
import Capacitor
@testable import App

// The two mode plugins carry each mode's intents, by Android's names, and no other method
// (issue #895): the method table is IntentPolicy's, and each entry has its method.
final class ModePluginsTests: XCTestCase {
    private func check(_ plugin: ModePlugin & CAPBridgedPlugin, _ mode: Mode, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(plugin.jsName, mode.plugin, file: file, line: line)
        let names = plugin.pluginMethods.map { $0.name ?? "" }
        XCTAssertEqual(names.count, Set(names).count, file: file, line: line)
        XCTAssertEqual(Set(names), IntentPolicy.of(mode), file: file, line: line)
        for name in names {
            XCTAssertTrue(plugin.responds(to: Selector(name + ":")), name, file: file, line: line)
        }
        let other: Mode = mode == .rider ? .instructor : .rider
        for name in IntentPolicy.of(other) {
            XCTAssertFalse(plugin.responds(to: Selector(name + ":")), name, file: file, line: line)
        }
    }

    func testTheRiderPluginCarriesRiderModesIntentsOnly() {
        check(RiderModePlugin(), .rider)
        XCTAssertEqual(Mode.rider.plugin, "RiderMode")
    }

    func testTheInstructorPluginCarriesInstructorModesIntentsOnly() {
        check(InstructorModePlugin(), .instructor)
        XCTAssertEqual(Mode.instructor.plugin, "InstructorMode")
    }

    func testThePluginsAreTheOnesThePolicyCalls() {
        XCTAssertEqual(PluginPolicy.callable, Set([Mode.rider.plugin, Mode.instructor.plugin]))
    }
}
