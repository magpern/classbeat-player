import UIKit

// The native screens over the page (issue #895), with Android's words. The questions are system
// alerts; the switching screen covers the page and takes every touch until the new page is up.
final class AlertScreens: ModeScreens {
    private weak var host: UIViewController?
    private var alert: UIAlertController?
    private var cover: UIView?

    /// What the no-passcode screen says: instructor mode needs a passcode on the device.
    static let noLockTitle = "A passcode is needed"
    static let noLockMessage = "Instructor mode needs a passcode on this device. Set one in Settings, then come back."
    static let noLockStay = "Stay in rider mode"

    init(host: UIViewController) {
        self.host = host
    }

    func noLock(stay: @escaping () -> Void) {
        let screen = UIAlertController(
            title: Self.noLockTitle,
            message: Self.noLockMessage,
            preferredStyle: .alert
        )
        screen.addAction(UIAlertAction(title: Self.noLockStay, style: .cancel) { _ in stay() })
        present(screen)
    }

    func riderQuestion(stay: @escaping () -> Void, switch toRider: @escaping () -> Void) {
        let screen = UIAlertController(
            title: "Switch to rider mode?",
            message: "The class list closes and the music is no longer followed. Coming back to instructor mode needs your screen lock.",
            preferredStyle: .alert
        )
        screen.addAction(UIAlertAction(title: "Stay", style: .cancel) { _ in stay() })
        screen.addAction(UIAlertAction(title: "Switch", style: .default) { _ in toRider() })
        present(screen)
    }

    /// What the unpair question says (docs/design/app-pairing-ios.md).
    static let unpairTitle = "Unpair this phone?"
    static let unpairMessage = "The classes saved on this phone are removed and instructor mode closes. Teaching from it again needs a new pairing."

    func unpairQuestion(stay: @escaping () -> Void, unpair: @escaping () -> Void) {
        let screen = UIAlertController(title: Self.unpairTitle, message: Self.unpairMessage, preferredStyle: .alert)
        // "Stay" is the main key and has the focus (app-modes.md, app-unpair-ask).
        let keep = UIAlertAction(title: "Stay", style: .cancel) { _ in stay() }
        screen.addAction(keep)
        screen.addAction(UIAlertAction(title: "Unpair", style: .destructive) { _ in unpair() })
        screen.preferredAction = keep
        present(screen)
    }

    func switching(rider: Bool) {
        hide()
        guard let view = host?.view else { return }
        let screen = UIView(frame: view.bounds)
        screen.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        screen.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = rider ? "Switching to rider mode" : "Switching to instructor mode"
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0
        title.translatesAutoresizingMaskIntoConstraints = false
        screen.addSubview(title)
        NSLayoutConstraint.activate([
            title.centerYAnchor.constraint(equalTo: screen.centerYAnchor),
            title.leadingAnchor.constraint(equalTo: screen.layoutMarginsGuide.leadingAnchor),
            title.trailingAnchor.constraint(equalTo: screen.layoutMarginsGuide.trailingAnchor),
        ])
        view.addSubview(screen)
        cover = screen
    }

    func hide() {
        cover?.removeFromSuperview()
        cover = nil
        if let shown = alert, shown.presentingViewController != nil, !shown.isBeingDismissed {
            shown.dismiss(animated: false)
        }
        alert = nil
    }

    private func present(_ screen: UIAlertController) {
        hide()
        alert = screen
        host?.present(screen, animated: true)
    }
}
