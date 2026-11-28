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
        // The smallest phone the spec names (issue #926): the code, the longest plate and paired.
        stage(width: 360, height: 640)
        show(waiting)
        keep("code-small")
        show(.unpaired(notice: .saveFailed))
        keep("plate-save-failed-small")
        show(.paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil))
        keep("paired-small")
        stage(width: 640, height: 360)
        show(waiting)
        keep("code-small-landscape")
        show(.unpaired(notice: .saveFailed))
        keep("plate-save-failed-small-landscape")
        // The tablet sizes the spec names (issue #990): the code, the longest plate and paired, both ways up.
        for (suffix, width, height) in [("tablet", CGFloat(768), CGFloat(1024)), ("tablet-landscape", 1024, 768)] {
            stage(width: width, height: height)
            show(waiting)
            keep("code-\(suffix)")
            show(.unpaired(notice: .saveFailed))
            keep("plate-save-failed-\(suffix)")
            show(.paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil))
            keep("paired-\(suffix)")
        }
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
        for (width, height) in [(CGFloat(393), CGFloat(852)), (852, 393), (360, 640), (640, 360), (768, 1024), (1024, 768)] {
            stage(width: width, height: height)
            show(waiting)
            XCTAssertEqual(buttons.count, 2)
            for key in buttons {
                XCTAssertGreaterThanOrEqual(key.frame.height, PairingScreenView.Sizes.touch, key.title(for: .normal) ?? "")
            }
        }
    }

    /// Every window the spec names (app.md A1): the phones and the tablets, both ways up.
    private static let windows: [(CGFloat, CGFloat)] = [
        (390, 844), (844, 390), (360, 640), (640, 360), (768, 1024), (1024, 768),
    ]

    /// A1's floors, written out here on purpose so lowering `Sizes` cannot lower them: the cap height
    /// as a share of the window height (portrait, landscape) and in points, as (portrait, landscape, points).
    private enum Floor {
        /// app.md "Measurable checks": every floored text sits at least 5 % over its floor.
        static let margin: CGFloat = 1.05
        static let value: (CGFloat, CGFloat, CGFloat) = (0.034, 0.06, 21)
        static let status: (CGFloat, CGFloat, CGFloat) = (0.019, 0.034, 12.5)
        static let label: (CGFloat, CGFloat, CGFloat) = (0.015, 0.027, 10)

        static func points(_ tier: (CGFloat, CGFloat, CGFloat), _ height: CGFloat, _ landscape: Bool) -> CGFloat {
            max(height * (landscape ? tier.1 : tier.0), tier.2) * margin
        }
    }

    private func tier(of text: String) -> (CGFloat, CGFloat, CGFloat) {
        if text == "BCDF-GHJK" || text == "Pair this phone" || text == "This phone is paired" { return Floor.value }
        if text == "Code" || text.hasPrefix("\u{25CF}") || text.hasPrefix("\u{25A1}") { return Floor.label }
        return Floor.status
    }

    private var states: [(String, PairingView)] {
        [
            ("asking", .starting), ("code", waiting),
            ("paired", .paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil)),
            ("plate", .unpaired(notice: .saveFailed)), ("plate-long", .unpaired(notice: .noKeychain)),
        ]
    }

    /// Every text's cap height, measured from the font it is drawn in, against its A1 floor at every window.
    func testEveryTextMeetsItsReadabilityFloorAtEveryWindow() {
        for (width, height) in Self.windows {
            let landscape = width > height
            stage(width: width, height: height)
            for (name, pairing) in states {
                show(pairing, returned: true)
                let spot = "\(Int(width))x\(Int(height)) \(name)"
                XCTAssertFalse(labels.isEmpty, spot)
                for label in labels {
                    let words = label.text ?? ""
                    let need = Floor.points(tier(of: words), height, landscape)
                    XCTAssertGreaterThanOrEqual(label.font.capHeight, need, "\(spot): \(words)")
                }
                for key in buttons {
                    let font = key.titleLabel?.font ?? .systemFont(ofSize: 1)
                    XCTAssertGreaterThanOrEqual(font.capHeight, Floor.points(Floor.status, height, landscape), "\(spot): \(key.title(for: .normal) ?? "")")
                }
            }
        }
    }

    /// The same floors as the share of the window height, the way the design review measures it.
    func testTheTitleCodeTagAndStatusShareOfTheWindowHeightMeetsA1() {
        for (width, height) in Self.windows {
            let landscape = width > height
            stage(width: width, height: height)
            show(waiting)
            let share = { (text: String) -> CGFloat in
                (self.labels.first { ($0.text ?? "").hasPrefix(text) }?.font.capHeight ?? 0) / height
            }
            let spot = "\(Int(width))x\(Int(height))"
            XCTAssertGreaterThanOrEqual(share("Pair this phone"), (landscape ? 0.06 : 0.034) * Floor.margin, "title \(spot)")
            XCTAssertGreaterThanOrEqual(share("BCDF-GHJK"), (landscape ? 0.06 : 0.034) * Floor.margin, "code \(spot)")
            XCTAssertGreaterThanOrEqual(share("\u{25CF}"), (landscape ? 0.027 : 0.015) * Floor.margin, "tag \(spot)")
            XCTAssertGreaterThanOrEqual(share("Code"), (landscape ? 0.027 : 0.015) * Floor.margin, "Code label \(spot)")
            XCTAssertGreaterThanOrEqual(share("The code runs out"), (landscape ? 0.034 : 0.019) * Floor.margin, "status \(spot)")
        }
    }

    /// Nothing scrolls: every text and key sits whole inside the window, and no label is squeezed
    /// below the height its words need.
    func testNothingOverflowsTheWindowAtEveryWindow() {
        for (width, height) in Self.windows {
            stage(width: width, height: height)
            for (name, pairing) in states {
                show(pairing, returned: true)
                guard let root = view.shown else { XCTFail("no screen for \(width)x\(height) \(name)"); continue }
                let spot = "\(Int(width))x\(Int(height)) \(name)"
                let items: [UIView] = labels + buttons
                for item in items {
                    let box = item.convert(item.bounds, to: root)
                    XCTAssertGreaterThanOrEqual(box.minX, -0.5, spot)
                    XCTAssertGreaterThanOrEqual(box.minY, -0.5, spot)
                    XCTAssertLessThanOrEqual(box.maxX, width + 0.5, spot)
                    XCTAssertLessThanOrEqual(box.maxY, height + 0.5, "\(spot): \((item as? UILabel)?.text ?? "key")")
                }
                for label in labels {
                    let needed = label.sizeThatFits(CGSize(width: label.bounds.width, height: .greatestFiniteMagnitude)).height
                    XCTAssertGreaterThanOrEqual(label.bounds.height + 0.5, needed, "\(spot): \(label.text ?? "")")
                }
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
        let tallest = labels.map { $0.font.capHeight }.max() ?? 0
        XCTAssertEqual(code.font.capHeight, tallest, "the code is the tallest text by cap height too")
        let spoken = code.accessibilityAttributedLabel
        XCTAssertEqual(spoken?.string, "BCDF-GHJK")
        XCTAssertEqual(spoken?.attribute(.accessibilitySpeechSpellOut, at: 0, effectiveRange: nil) as? Bool, true)
    }

    /// Every pairing screen draws in the bundled fonts, never the system's (issue #988).
    func testEveryWordIsInABundledFont() {
        XCTAssertNotNil(UIFont(name: PairingFonts.numberName, size: 20), "the number face is registered")
        XCTAssertNotNil(UIFont(name: PairingFonts.textName, size: 20), "the text face is registered")
        XCTAssertNotNil(UIFont(name: PairingFonts.textBoldName, size: 20), "the bold text face is registered")
        let pairings: [PairingView] = [
            .starting, waiting, .paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil),
            .unpaired(notice: .noKeychain),
        ]
        for pairing in pairings {
            show(pairing, returned: true)
            for label in labels { XCTAssertTrue(PairingFonts.names.contains(label.font.fontName), "\(label.text ?? ""): \(label.font.fontName)") }
            for key in buttons {
                XCTAssertEqual(key.titleLabel?.font.fontName, PairingFonts.textBoldName, key.title(for: .normal) ?? "")
            }
        }
    }

    func testTheTitleCodeAndNumeralsUseTheNumberFace() {
        show(waiting)
        let faces = Dictionary(labels.compactMap { l in l.text.map { ($0, l.font.fontName) } }, uniquingKeysWith: { a, _ in a })
        XCTAssertEqual(faces["Pair this phone"], PairingFonts.numberName)
        XCTAssertEqual(faces["BCDF-GHJK"], PairingFonts.numberName)
        for numeral in ["1", "2", "3"] { XCTAssertEqual(faces[numeral], PairingFonts.numberName, numeral) }
        XCTAssertEqual(faces["●  Instructor mode"], PairingFonts.textBoldName)
        XCTAssertEqual(faces["Sign in and type the code."], PairingFonts.textName)
    }

    func testStepOneSaysYourBrowserAndNoPlatform() {
        show(waiting)
        let one = labels.compactMap { $0.text }.first { $0.hasPrefix("Open " + page) }
        XCTAssertEqual(one, "Open " + page + ": the button below opens it in your browser")
        for word in labels.compactMap({ $0.text }) {
            XCTAssertFalse(word.contains("Safari"), word)
            XCTAssertFalse(word.contains("iOS"), word)
        }
    }

    func testTheCodeStaysOnOneLineAt360Wide() {
        stage(width: 360, height: 640)
        show(waiting)
        guard let code = labels.first(where: { $0.accessibilityIdentifier == "pairing.code" }) else {
            return XCTFail("no code label")
        }
        let wanted = code.attributedText?.size().width ?? .infinity
        XCTAssertLessThanOrEqual(wanted, code.bounds.width + 0.5, "the code fits its line without wrapping")
        XCTAssertFalse(code.adjustsFontSizeToFitWidth)
        XCTAssertEqual(code.numberOfLines, 1)
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

    /// A screen shown while the app is away (a poll answered in the background) starts concealed,
    /// and a screen shown after the app is back is not.
    func testAScreenShownWhileAwayStartsConcealed() {
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        show(waiting)
        XCTAssertTrue(view.concealed)
        let pages = all(view.shown).filter { !($0 is UILabel) && $0.isHidden }
        XCTAssertFalse(pages.isEmpty, "the page is built hidden")
        XCTAssertTrue(labels.contains { $0.accessibilityIdentifier == "pairing.code" })
        show(.paired(email: "rider@classbeat.test", deviceName: nil, expired: false, notice: nil))
        XCTAssertTrue(view.concealed)
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertFalse(view.concealed)
        show(waiting)
        XCTAssertFalse(view.concealed)
        view.hide()
        center.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        show(waiting)
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
