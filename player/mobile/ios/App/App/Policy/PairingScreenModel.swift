// What the native pairing screen shows for each pairing state (issue #925,
// docs/design/app-pairing-ios.md over app-pairing.md): the Swift twin of Android's
// PairingScreenModel.kt with the iOS words. Pure: no import. It reads only PairingView, which holds
// no token and no device code, so no line can carry one.
enum PairingScreenModel {
    enum Action: Equatable {
        case cancel, open, proceed, rider, startAgain
    }

    struct Key: Equatable {
        let label: String
        let main: Bool
        let action: Action
    }

    /// `lead` goes first (and left in landscape); `act` (the steps) goes with the keys.
    struct Screen: Equatable {
        let lead: [ScreenLine]
        let act: [ScreenLine]
        let keys: [Key]

        var lines: [ScreenLine] { lead + act }
    }

    private static let tag = ScreenLine.tag("Instructor mode")
    private static let title = ScreenLine.title("Pair this phone")
    private static let plateKeys = [Key(label: "Start again", main: true, action: .startAgain), Key(label: "Rider mode", main: false, action: .rider)]

    /// Whether opening the screen starts a pairing at once. A notice (unpaired on the website, a
    /// code run out, a failure) is held instead, and only "Start again" begins; "unpaired" by this
    /// phone asks as usual.
    static func begins(_ view: PairingView) -> Bool {
        guard case let .unpaired(notice) = view else { return true }
        return notice == nil || notice == .unpaired
    }

    /// `returned` is true once the app came back from Safari while the code showed; `instructor` is
    /// true for "pair again" from instructor mode, where no passcode is asked after pairing.
    static func screen(_ view: PairingView, now: Int, returned: Bool, instructor: Bool) -> Screen {
        switch view {
        case .starting:
            return asking()
        // Unpaired here (the page's unpair) is no ending to report: the screen opens to pair anew.
        case let .unpaired(notice):
            guard let notice = notice, notice != .unpaired else { return asking() }
            return plate(notice)
        case let .waiting(userCode, page, expiresAt):
            return code(userCode, page, left(expiresAt, now), returned)
        case let .paired(email, _, expired, notice):
            if let notice = notice { return plate(notice) }
            return expired ? asking() : paired(email, instructor)
        }
    }

    /// "m:ss" left, rounded up, never below 0:00.
    static func left(_ expiresAt: Int, _ now: Int) -> String {
        let s = (max(expiresAt - now, 0) + 999) / 1000
        let seconds = s % 60
        return "\(s / 60):" + (seconds < 10 ? "0" : "") + "\(seconds)"
    }

    private static func asking() -> Screen {
        Screen(lead: [tag, title, .working("Asking the server for a code")], act: [], keys: [Key(label: "Cancel", main: false, action: .cancel)])
    }

    private static func code(_ userCode: String, _ page: String, _ left: String, _ returned: Bool) -> Screen {
        var lead = [tag, title]
        if returned { lead.append(.working("Not yet confirmed on the website")) }
        lead.append(.code(userCode))
        lead.append(.text("The code runs out in " + left))
        let steps: [ScreenLine] = [
            .step(1, "Open " + page + ": the button below opens it in your browser"),
            .step(2, "Sign in and type the code."),
            .step(3, "Confirm only if this phone shows the same code."),
        ]
        let open = Key(label: returned ? "Open the page again" : "Open the site", main: true, action: .open)
        return Screen(lead: lead, act: steps, keys: [open, Key(label: "Cancel", main: false, action: .cancel)])
    }

    private static func paired(_ email: String?, _ instructor: Bool) -> Screen {
        var lead = [tag, ScreenLine.title("This phone is paired")]
        if let email = email { lead.append(.text("Paired as " + email)) }
        // The same words whichever of Face ID, Touch ID or the passcode the phone uses.
        if !instructor { lead.append(.text("Confirm it is you to open instructor mode.")) }
        return Screen(lead: lead, act: [], keys: [Key(label: "Continue", main: true, action: .proceed)])
    }

    private static func plate(_ notice: PairingMachine.Notice) -> Screen {
        let words: (String, String)
        switch notice {
        // No passcode: the Keychain refuses the token. Setting a passcode can fix it, so "Start
        // again" is offered; it checks again.
        case .noKeychain:
            words = ("This phone cannot be paired.", "Pairing needs a passcode to keep it safe. Set one in Settings, then start again. Rider mode works without it.")
        case .denied: words = ("Refused on the website.", "Nothing was kept on this phone.")
        case .codeExpired: words = ("The code ran out.", "It was not confirmed in time. Start again for a new code.")
        // Every iOS build has no server address yet (ADR 0016 section 4): to the user it is unreachable.
        case .unreachable, .noServer: words = ("The server could not be reached.", "Check the connection, then start again.")
        case .tooMany: words = ("Too many pairings were started.", "Try again in an hour.")
        case .unexpected: words = ("The answer was not understood.", "The app could not read the server's answer. Try again later.")
        case .saveFailed: words = ("The pairing could not be kept.", "The Keychain did not keep it, so the pairing was undone. Start again.")
        case .revokedOnSite, .unpaired: words = ("Unpaired on the website.", "The classes saved on this phone were removed.")
        }
        return Screen(lead: [tag, title, .plate(head: words.0, body: words.1)], act: [], keys: plateKeys)
    }
}
