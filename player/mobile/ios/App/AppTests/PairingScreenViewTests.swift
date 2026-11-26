import XCTest
import UIKit
@testable import App

// The native pairing screen as drawn (issue #925, docs/design/app-pairing-ios.md): every state is
// kept as a screenshot, the keys are large enough to touch, the code is spelled out to VoiceOver,
// and the page is concealed whenever the app leaves the front. No network: the screens come from
// PairingScreenModel on plain values.
final class PairingScreenViewTests: XCTestCase {
    private typealias M = PairingScreenModel
    private let page = "https://classbeat.test/pair"
    private var center: NotificationCenter!
    private var host: UIViewController!
    private var view: PairingScreenView!
    private var pressed: [M.Action] = []

    override func setUp() {
        super.setUp()
        center = NotificationCenter()
        pressed = []
        stage(width: 393, height: 852)
    }

    private func stage(width: CGFloat, height: CGFloat) {
        host = UIViewController()
        host.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
        view = PairingScreenView(host: host, center: center, reduceMotion: { true })
    }

    private func show(_ pairing: PairingView, returned: Bool = false, instructor: Bool = false) {
        view.show(M.screen(pairing, now: 0, returned: returned, instructor: instructor)) { [unowned self] in
            self.pressed.append($0)
        }
        view.shown?.layoutIfNeeded()
    }

    private var waiting: PairingView { .waiting(userCode: "BCDF-GHJK", page: page, expiresAt: 600_000) }

    private func all(_ root: UIView?) -> [UIView] {
        guard let root else { return [] }
        return [root] + root.subviews.flatMap { all($0) }
    }

    private var labels: [UILabel] { all(view.shown).compactMap { $0 as? UILabel } }
    private var buttons: [UIButton] { all(view.shown).compactMap { $0 as? UIButton } }

    private func button(_ title: String) -> UIButton? {
        buttons.first { $0.title(for: .normal) == title }
    }

    /// Keeps the screen as a screenshot in the result bundle.
    private func keep(_ name: String) {
        guard let root = view.shown else { return XCTFail("no screen for \(name)") }
        root.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: root.bounds).image { root.layer.render(in: $0.cgContext) }
        let shot = XCTAttachment(image: image)
        shot.name = "ios-pair-\(name)"
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testEveryStateIsKeptAsAScreenshot() {
        show(.starting)
        keep("asking")
        show(waiting)
        keep("code")
        show(waiting, returned: true)
        keep("code-returned")
        show(.paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil))
        keep("paired")
        let notices: [(String, PairingMachine.Notice)] = [
            ("no-server", .noServer), ("no-passcode", .noKeychain), ("too-many", .tooMany),
            ("unreachable", .unreachable), ("unexpected", .unexpected), ("denied", .denied),
            ("code-expired", .codeExpired), ("save-failed", .saveFailed), ("revoked", .revokedOnSite),
        ]
        for (name, notice) in notices {
            show(.unpaired(notice: notice))
            XCTAssertNotNil(button("Start again"), name)
            keep("plate-\(name)")
        }
        stage(width: 852, height: 393)
        show(waiting)
        keep("code-landscape")
        show(.unpaired(notice: .noKeychain))
        keep("plate-no-passcode-landscape")
    }

    func testTheScreenCoversThePageAndIsModal() {
        show(waiting)
        let root = view.shown
        XCTAssertTrue(root?.superview === host.view)
        XCTAssertEqual(root?.frame, host.view.bounds)
        XCTAssertEqual(root?.accessibilityViewIsModal, true)
        view.hide()
        XCTAssertNil(view.shown)
        XCTAssertTrue(host.view.subviews.isEmpty)
    }

    func testEveryKeyIsLargeEnoughToTouch() {
        for (width, height) in [(CGFloat(393), CGFloat(852)), (852, 393)] {
            stage(width: width, height: height)
            show(waiting)
            XCTAssertEqual(buttons.count, 2)
            for key in buttons {
                XCTAssertGreaterThanOrEqual(key.frame.height, PairingScreenView.Sizes.touch, key.title(for: .normal) ?? "")
            }
        }
    }

    func testTheCodeIsTheLargestTextAndSpelledOut() {
        show(waiting)
        guard let code = labels.first(where: { $0.accessibilityIdentifier == "pairing.code" }) else {
            return XCTFail("no code label")
        }
        XCTAssertEqual(code.text, "BCDF-GHJK")
        XCTAssertEqual(code.numberOfLines, 1)
        let biggest = labels.map { $0.font.pointSize }.max() ?? 0
        XCTAssertEqual(code.font.pointSize, biggest)
        let spoken = code.accessibilityAttributedLabel
        XCTAssertEqual(spoken?.string, "BCDF-GHJK")
        XCTAssertEqual(spoken?.attribute(.accessibilitySpeechSpellOut, at: 0, effectiveRange: nil) as? Bool, true)
    }

    func testNoLabelHoldsTheTokenOrTheDeviceCode() {
        for pairing in [PairingView.starting, waiting, .paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil)] {
            show(pairing)
            for label in labels {
                let words = label.text ?? ""
                XCTAssertFalse(words.contains(Secrets.token()))
                XCTAssertFalse(words.contains(Secrets.deviceCode()))
            }
        }
    }

    /// The app switcher's snapshot is taken after the app resigns: the code is gone by then.
    func testThePageIsConcealedWhileTheAppIsNotInFront() {
        show(waiting)
        XCTAssertFalse(view.concealed)
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        XCTAssertTrue(view.concealed)
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(view.concealed)
        center.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        XCTAssertTrue(view.concealed)
    }

    func testAKeyPressesItsAction() {
        show(waiting)
        button("Open the site")?.sendActions(for: .primaryActionTriggered)
        button("Cancel")?.sendActions(for: .primaryActionTriggered)
        XCTAssertEqual(pressed, [.open, .cancel])
    }

    func testTheLeftEdgeSwipeIsCancel() {
        show(waiting)
        let edges = view.shown?.gestureRecognizers?.compactMap { $0 as? UIScreenEdgePanGestureRecognizer } ?? []
        XCTAssertEqual(edges.map { $0.edges }, [.left])
        view.swiped()
        XCTAssertEqual(pressed, [.cancel])
        view.hide()
        view.swiped()
        XCTAssertEqual(pressed, [.cancel], "nothing after the screen went")
    }

    /// The countdown changes the words in place, so VoiceOver's focus stays where it is.
    func testRetextKeepsTheViews() {
        show(waiting)
        let root = view.shown
        let next = M.screen(waiting, now: 1_000, returned: false, instructor: false)
        XCTAssertTrue(view.retext(next))
        XCTAssertTrue(view.shown === root)
        XCTAssertTrue(labels.contains { $0.text == "The code runs out in 9:59" })
        XCTAssertFalse(view.retext(M.screen(.starting, now: 0, returned: false, instructor: false)))
    }
}
