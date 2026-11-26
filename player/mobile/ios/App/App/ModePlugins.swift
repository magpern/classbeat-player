import Foundation
import Capacitor

// The two mode plugins (issue #895, ADR 0016 section 3), with Android's names: RiderMode and
// InstructorMode, one method per intent IntentPolicy names for that mode and no other. Each method
// only carries the call to the main thread and hands it to ModeController, which checks it against
// the mode the app is in and answers it; BridgeFilter has already dropped any call to a plugin that
// is not on the bridge now. The answer is the result data or the one refused word, never an error
// text of ours.
class ModePlugin: CAPPlugin {
    /// The one word a refused call hears.
    static let refused = "refused"

    weak var controller: ModeController?

    /// The mode whose intents this plugin carries.
    var mode: Mode { preconditionFailure("classbeat: a mode plugin without a mode") }

    /// The intents, as Capacitor's method table.
    var intentMethods: [CAPPluginMethod] {
        IntentPolicy.of(mode).sorted().map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    }

    func forward(_ name: String, _ call: CAPPluginCall) {
        var args: [String: Any] = [:]
        for (key, value) in call.options ?? [:] {
            guard let key = key as? String else {
                call.reject(Self.refused)
                return
            }
            args[key] = value
        }
        let mode = self.mode
        DispatchQueue.main.async { [weak self] in
            guard let controller = self?.controller else {
                call.reject(Self.refused)
                return
            }
            controller.handle(mode, name, args, BridgedCall(call))
        }
    }
}

/// A page call as ModeController sees it.
final class BridgedCall: PageCall {
    private let call: CAPPluginCall

    init(_ call: CAPPluginCall) {
        self.call = call
    }

    func answer(_ data: [String: Any]) {
        call.resolve(data)
    }

    func refuse() {
        call.reject(ModePlugin.refused)
    }
}

final class RiderModePlugin: ModePlugin, CAPBridgedPlugin {
    let identifier = "RiderModePlugin"
    let jsName = Mode.rider.plugin
    override var mode: Mode { .rider }
    var pluginMethods: [CAPPluginMethod] { intentMethods }

    @objc func instructorWay(_ call: CAPPluginCall) { forward("instructorWay", call) }
    @objc func askInstructorMode(_ call: CAPPluginCall) { forward("askInstructorMode", call) }
    @objc func join(_ call: CAPPluginCall) { forward("join", call) }
    @objc func open(_ call: CAPPluginCall) { forward("open", call) }
    @objc func receive(_ call: CAPPluginCall) { forward("receive", call) }
    @objc func leave(_ call: CAPPluginCall) { forward("leave", call) }
}

final class InstructorModePlugin: ModePlugin, CAPBridgedPlugin {
    let identifier = "InstructorModePlugin"
    let jsName = Mode.instructor.plugin
    override var mode: Mode { .instructor }
    var pluginMethods: [CAPPluginMethod] { intentMethods }

    @objc func askRiderMode(_ call: CAPPluginCall) { forward("askRiderMode", call) }
    @objc func listClasses(_ call: CAPPluginCall) { forward("listClasses", call) }
    @objc func syncNow(_ call: CAPPluginCall) { forward("syncNow", call) }
    @objc func getClass(_ call: CAPPluginCall) { forward("getClass", call) }
    @objc func unpair(_ call: CAPPluginCall) { forward("unpair", call) }
    @objc func pairAgain(_ call: CAPPluginCall) { forward("pairAgain", call) }
    @objc func followAccess(_ call: CAPPluginCall) { forward("followAccess", call) }
    @objc func openFollowSetting(_ call: CAPPluginCall) { forward("openFollowSetting", call) }
    @objc func follow(_ call: CAPPluginCall) { forward("follow", call) }
    @objc func unfollow(_ call: CAPPluginCall) { forward("unfollow", call) }
    @objc func reading(_ call: CAPPluginCall) { forward("reading", call) }
    @objc func sendPlay(_ call: CAPPluginCall) { forward("sendPlay", call) }
    @objc func sendPause(_ call: CAPPluginCall) { forward("sendPause", call) }
    @objc func sendNext(_ call: CAPPluginCall) { forward("sendNext", call) }
}
