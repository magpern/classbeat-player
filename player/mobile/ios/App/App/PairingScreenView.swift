import UIKit

// The native pairing screen (issue #925, docs/design/app-pairing-ios.md): it draws
// PairingScreenModel's screens over the page with Android's layout (ModeScreens.kt). The web view
// cannot draw or read it. The edge swipe is "Cancel". The page is concealed whenever the app leaves
// the front, so the system's app-switcher snapshot never holds the code.
final class PairingScreenView: NSObject, PairingScreens {
    private weak var host: UIViewController?
    private let reduceMotion: () -> Bool
    private var root: UIView?
    private var page: UIView?
    private var press: (PairingScreenModel.Action) -> Void = { _ in }
    private var setters: [(ScreenLine) -> Void] = []
    private var kinds: [Int] = []
    /// The app is not in front: a page built now starts hidden, so a screen shown in the
    /// background (a poll answered, a notice) never reaches the app switcher's snapshot.
    private var away = false

    /// The cross-fade, under the spec's 300 ms; none with Reduce Motion.
    static let fade = 0.2

    // docs/design tokens: stage, stage-raised, light-1, light-2, light-3, ink. No hue (rule 7).
    static let stage = UIColor(red: 0, green: 0, blue: 0, alpha: 1)
    static let stageRaised = UIColor(red: 0x17 / 255.0, green: 0x17 / 255.0, blue: 0x1c / 255.0, alpha: 1)
    static let light1 = UIColor(red: 0xf6 / 255.0, green: 0xf4 / 255.0, blue: 0xef / 255.0, alpha: 1)
    static let light2 = UIColor(red: 0xbd / 255.0, green: 0xba / 255.0, blue: 0xb2 / 255.0, alpha: 1)
    static let light3 = UIColor(red: 0x9a / 255.0, green: 0x97 / 255.0, blue: 0x8f / 255.0, alpha: 1)
    static let ink = UIColor(red: 0, green: 0, blue: 0, alpha: 1)

    /// `center` tells when the app leaves and regains the front (a test posts to its own).
    init(host: UIViewController, center: NotificationCenter = .default, reduceMotion: @escaping () -> Bool = { UIAccessibility.isReduceMotionEnabled }) {
        self.host = host
        self.reduceMotion = reduceMotion
        super.init()
        center.addObserver(self, selector: #selector(conceal), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(conceal), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(reveal), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// The screen showing, for the tests and the shell.
    var shown: UIView? { root }

    /// Whether the page is concealed (the app is not in front).
    var concealed: Bool { page?.isHidden ?? away }

    func show(_ screen: PairingScreenModel.Screen, press: @escaping (PairingScreenModel.Action) -> Void) {
        hide()
        guard let view = host?.view else { return }
        self.press = press
        let landscape = view.bounds.width > view.bounds.height
        let size = Sizes(height: view.bounds.height, landscape: landscape)
        let root = UIView(frame: view.bounds)
        root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.backgroundColor = Self.stage
        // Takes every touch, so nothing reaches the page underneath.
        root.isUserInteractionEnabled = true
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edged(_:)))
        edge.edges = .left
        root.addGestureRecognizer(edge)

        let lead = column()
        screen.lead.forEach { lead.addArrangedSubview(line($0, size)) }
        let act = column()
        screen.act.forEach { act.addArrangedSubview(line($0, size)) }
        screen.keys.forEach { act.addArrangedSubview(key($0, size)) }
        kinds = screen.lines.map { $0.kind }

        let page = UIStackView()
        page.axis = landscape ? .horizontal : .vertical
        page.spacing = 16
        page.translatesAutoresizingMaskIntoConstraints = false
        page.isHidden = away
        if landscape {
            page.distribution = .fillEqually
            page.alignment = .center
        } else {
            page.alignment = .fill
        }
        page.addArrangedSubview(lead)
        // Portrait: the steps and keys sit at the bottom, within reach of the thumb.
        if !landscape { page.addArrangedSubview(UIView()) }
        page.addArrangedSubview(act)
        lead.setContentHuggingPriority(.required, for: .vertical)
        act.setContentHuggingPriority(.required, for: .vertical)
        root.addSubview(page)
        let safe = root.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            page.topAnchor.constraint(equalTo: safe.topAnchor, constant: 16),
            page.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -16),
            page.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            page.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
        ])
        view.addSubview(root)
        self.root = root
        self.page = page
        root.accessibilityViewIsModal = true
        if !reduceMotion() {
            root.alpha = 0
            UIView.animate(withDuration: Self.fade) { root.alpha = 1 }
        }
        UIAccessibility.post(notification: .screenChanged, argument: nil)
    }

    func retext(_ screen: PairingScreenModel.Screen) -> Bool {
        let lines = screen.lines
        guard root != nil, lines.count == setters.count, lines.map({ $0.kind }) == kinds else { return false }
        zip(setters, lines).forEach { set, line in set(line) }
        return true
    }

    func hide() {
        root?.removeFromSuperview()
        root = nil
        page = nil
        setters = []
        kinds = []
        press = { _ in }
    }

    @objc private func edged(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .recognized || gesture.state == .ended { swiped() }
    }

    /// A finished swipe from the left edge: "Cancel", as the system's back gesture would be.
    func swiped() {
        press(.cancel)
    }

    /// The app is leaving the front: the page goes, so the app switcher shows a blank stage.
    @objc private func conceal() {
        away = true
        page?.isHidden = true
    }

    @objc private func reveal() {
        away = false
        page?.isHidden = false
    }

    // The parts, as Android's ModeScreens draws them.

    private func column() -> UIStackView {
        let column = UIStackView()
        column.axis = .vertical
        column.alignment = .fill
        column.spacing = 12
        return column
    }

    private func line(_ line: ScreenLine, _ size: Sizes) -> UIView {
        switch line {
        case let .code(code):
            let box = panel(Self.stageRaised)
            box.addArrangedSubview(text("Code", size.label, Self.light2, bold: false))
            // The largest text on the screen, never wrapped, read letter by letter by VoiceOver.
            let label = text(code, size.value * Sizes.codeScale, Self.light1, bold: true)
            label.font = PairingFonts.number(size.value * Sizes.codeScale)
            label.numberOfLines = 1
            label.adjustsFontSizeToFitWidth = false
            label.accessibilityIdentifier = "pairing.code"
            box.addArrangedSubview(label)
            setters.append { [weak label] line in
                guard case let .code(code) = line else { return }
                Self.spell(label, code)
            }
            Self.spell(label, code)
            return box
        case let .plate(head, body):
            let box = panel(Self.light1)
            let top = text(head, size.text, Self.ink, bold: true)
            let rest = text(body, size.text, Self.ink, bold: false)
            box.addArrangedSubview(top)
            box.addArrangedSubview(rest)
            setters.append { [weak top, weak rest] line in
                guard case let .plate(head, body) = line else { return }
                top?.text = head
                rest?.text = body
            }
            return box
        case let .step(number, words):
            // The numeral in the number face, the words in the text face, side by side (app.css .steps).
            let numeral = text("\(number)", size.text, Self.light1, bold: true)
            numeral.font = PairingFonts.number(size.text)
            numeral.setContentHuggingPriority(.required, for: .horizontal)
            numeral.setContentCompressionResistancePriority(.required, for: .horizontal)
            let said = text(words, size.text, Self.light1, bold: false)
            let row = UIStackView(arrangedSubviews: [numeral, said])
            row.axis = .horizontal
            row.alignment = .firstBaseline
            row.spacing = 12
            setters.append { [weak numeral, weak said] line in
                guard case let .step(number, words) = line else { return }
                numeral?.text = "\(number)"
                said?.text = words
            }
            return row
        default:
            let label: UILabel
            switch line {
            case .tag: label = text(line.words, size.label, Self.light2, bold: true)
            case .note: label = text(line.words, size.label, Self.light2, bold: false)
            case .title:
                label = text(line.words, size.value, Self.light1, bold: true)
                label.font = PairingFonts.number(size.value)
                label.accessibilityTraits = .header
            default: label = text(line.words, size.text, Self.light1, bold: false)
            }
            setters.append { [weak label] line in label?.text = line.words }
            return label
        }
    }

    private static func spell(_ label: UILabel?, _ code: String) {
        label?.text = code
        label?.attributedText = NSAttributedString(string: code, attributes: [
            .font: label?.font ?? PairingFonts.number(21),
            .foregroundColor: light1,
            .kern: (label?.font.pointSize ?? 21) * 0.15,
        ])
        label?.accessibilityAttributedLabel = NSAttributedString(string: code, attributes: [.accessibilitySpeechSpellOut: true])
    }

    private func text(_ words: String, _ points: CGFloat, _ color: UIColor, bold: Bool) -> UILabel {
        let label = UILabel()
        label.text = words
        label.font = PairingFonts.text(points, bold: bold)
        label.textColor = color
        label.numberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        return label
    }

    private func panel(_ color: UIColor) -> UIStackView {
        let box = column()
        box.backgroundColor = color
        box.layer.cornerRadius = 8
        box.isLayoutMarginsRelativeArrangement = true
        box.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
        return box
    }

    private func key(_ key: PairingScreenModel.Key, _ size: Sizes) -> UIButton {
        let button = UIButton(type: .custom)
        button.setTitle(key.label, for: .normal)
        button.setTitleColor(key.main ? Self.ink : Self.light1, for: .normal)
        button.titleLabel?.font = PairingFonts.text(size.key, bold: true)
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.textAlignment = .center
        button.backgroundColor = key.main ? Self.light1 : Self.stageRaised
        button.layer.cornerRadius = 8
        button.layer.borderWidth = 2
        button.layer.borderColor = (key.main ? Self.light1 : Self.light3).cgColor
        button.contentEdgeInsets = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: Sizes.touch).isActive = true
        let action = key.action
        button.addAction(UIAction { [weak self] _ in self?.press(action) }, for: .primaryActionTriggered)
        return button
    }

    /// The spec's floors: a share of the window height, portrait or landscape, never under the minimum.
    struct Sizes {
        static let codeScale: CGFloat = 1.25
        static let touch: CGFloat = 64
        let value: CGFloat
        let text: CGFloat
        let key: CGFloat
        let label: CGFloat

        init(height: CGFloat, landscape: Bool) {
            value = max(height * (landscape ? 0.06 : 0.034), 21)
            text = max(height * (landscape ? 0.045 : 0.026), 16.5)
            key = max(height * (landscape ? 0.034 : 0.019), 12.5)
            label = max(height * (landscape ? 0.027 : 0.015), 10)
        }
    }
}

/// A tick once a second on the main run loop, for the code's countdown.
final class SecondTicker: Ticker {
    private var timer: Timer?

    func start(_ tick: @escaping () -> Void) {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in tick() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }
}
