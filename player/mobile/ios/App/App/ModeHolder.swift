// Holds the app's mode (issue #895, ADR 0011 section 1): the Swift twin of Android's ModeHolder.kt,
// tested with the same cases (AppTests/ModeHolderTests.swift). Only native code calls it; nothing
// the page asks can select, change or unlock a mode. Not thread-safe: the edge calls it on the main
// thread only. Pure: no import at all.

/// Native storage for the last mode used: the app's own defaults, which the web view cannot reach.
protocol ModeStore: AnyObject {
    func read() -> String?

    /// Writes the mode durably before returning; throws if it could not.
    func write(_ value: String) throws

    /// True while a switch's drops have started and not all finished: the next start wipes first.
    func wipePending() -> Bool

    /// Writes the flag durably before returning; throws if it could not.
    func setWipePending(_ pending: Bool) throws
}

/// What the holder asks the device. Read again at every decision, never cached.
protocol Device: AnyObject {
    var paired: Bool { get }
    var secureLock: Bool { get }
}

/// One thing a switch drops (ModePolicy.teardown names them). `drop` starts the drop and calls its
/// `done` once it has finished, with nil, or with what went wrong; it may also throw. A drop that
/// finishes later (the web view's storage) holds the switch until it does.
struct Teardown {
    let name: String
    let drop: (@escaping (Error?) -> Void) throws -> Void
}

/// What the holder has the screen and the bridge do. The iOS edge implements it (ModeController).
protocol ModeEffects: AnyObject {
    /// Takes every intent off the bridge: the page can call nothing until `open`.
    func closeBridge()

    /// Loads `mode`'s start page fresh, and puts its intents, and only those, on the bridge once no other page is left (PageOpener).
    func open(_ mode: Mode)

    /// Asks the device owner's authentication; its answer comes back through ModeHolder.lockAnswered.
    func askLock()

    /// The native "A passcode is needed" screen.
    func showNoLock()

    /// The native "Switch to rider mode?" question.
    func askRiderQuestion()

    /// The native switching screen while the switch to `mode` runs.
    func showSwitching(_ mode: Mode)

    /// A part could not be dropped: the app stops rather than show a page with it left.
    func fatal(_ failed: [String])
}

struct WrongTeardown: Error {}

final class ModeHolder {
    /// The name ModeEffects.fatal gets when the mode could not be written.
    static let storeFailure = "store"

    /// What the holder is waiting for, if anything.
    enum Pending: Equatable {
        case lock, noLock, riderQuestion
    }

    private let store: ModeStore
    private let device: Device
    private unowned let effects: ModeEffects
    private let parts: [Teardown]

    /// The mode the app is in; nil while it is between modes, when every intent is refused.
    private(set) var current: Mode?
    private(set) var pending: Pending?

    /// The app reopened toward instructor mode: the lock is asked once rider mode is open.
    private var reask = false

    init(store: ModeStore, device: Device, effects: ModeEffects, parts: [Teardown]) throws {
        guard parts.map({ $0.name }) == ModePolicy.teardown else { throw WrongTeardown() }
        self.store = store
        self.device = device
        self.effects = effects
        self.parts = parts
    }

    /// Whether "Switch to instructor mode" goes to pairing or to the lock, for the strip's lead line.
    var paired: Bool { device.paired }

    var secureLock: Bool { device.secureLock }

    /// Opens the app in rider mode and loads its start page. When the last mode used was instructor
    /// mode (ModePolicy.startMode: still paired, with a passcode), the lock is asked again at once,
    /// as for any entry from rider mode: a reopen never skips it, and nothing of instructor mode
    /// shows before it passes. A switch the app was stopped in the middle of is finished first:
    /// every part is dropped again before any page loads.
    func start() {
        reask = ModePolicy.startMode(store.read(), paired: device.paired, secureLock: device.secureLock) == .instructor
        if store.wipePending() {
            _ = switchTo(.rider)
            return
        }
        // Written back so a value that did not open instructor mode is gone; the lock writes it again.
        // A failure here only means the next start asks for the lock again.
        try? store.write(Mode.rider.stored)
        current = .rider
        effects.open(.rider)
        askAgain()
    }

    private func askAgain() {
        if !reask { return }
        reask = false
        // Lost the pairing or the passcode meanwhile: the app simply stays in rider mode.
        if ModePolicy.entry(paired: device.paired, secureLock: device.secureLock) != .askLock { return }
        pending = .lock
        effects.askLock()
    }

    /// The pairing ended: instructor mode closes at once, with no question, as any switch does.
    func unpaired() {
        if current != .instructor { return }
        pending = nil
        _ = switchTo(.rider)
    }

    /// "Switch to instructor mode" in rider mode. Returns the way it went, or nil if refused.
    func askInstructor() -> ModePolicy.Entry? {
        if current != .rider || pending != nil { return nil }
        let entry = ModePolicy.entry(paired: device.paired, secureLock: device.secureLock)
        switch entry {
        case .pair:
            break
        case .noLock:
            pending = .noLock
            effects.showNoLock()
        case .askLock:
            pending = .lock
            effects.askLock()
        }
        return entry
    }

    /// The device owner's authentication answered. Returns true if instructor mode opened.
    func lockAnswered(_ passed: Bool) -> Bool {
        let asked = pending == .lock && current == .rider
        if pending == .lock { pending = nil }
        if !ModePolicy.opensInstructor(asked: asked, passed: passed, paired: device.paired, secureLock: device.secureLock) {
            return false
        }
        return switchTo(.instructor)
    }

    /// The app came back while the no-lock screen showed: a passcode may have been set meanwhile.
    func noLockReturned() {
        if pending != .noLock { return }
        pending = nil
        _ = askInstructor()
    }

    /// "Stay in rider mode" on the no-lock screen.
    func noLockStay() {
        if pending == .noLock { pending = nil }
    }

    /// "Switch to rider mode" in instructor mode. Returns false if refused.
    func askRider() -> Bool {
        if current != .instructor || pending != nil { return false }
        pending = .riderQuestion
        effects.askRiderQuestion()
        return true
    }

    /// The question answered: "Switch" is `toRider` true; "Stay" or leaving the app is false.
    func riderAnswered(_ toRider: Bool) -> Bool {
        if pending != .riderQuestion { return false }
        pending = nil
        if !toRider || current != .instructor { return false }
        return switchTo(.rider)
    }

    /// Rider mode is written first, so a switch cut short opens in rider mode next time; instructor
    /// mode only after everything was dropped. Every part is dropped in both directions, and the
    /// page opens only once every drop has finished; if any fails the page is not opened and the
    /// app stops. Returns false if the switch stopped; true if it opened or is still dropping.
    private func switchTo(_ target: Mode) -> Bool {
        current = nil
        effects.closeBridge()
        effects.showSwitching(target)
        var failed: [String] = []
        if target == .rider {
            do { try store.write(Mode.rider.stored) } catch { failed.append(Self.storeFailure) }
        }
        // Before the first drop: a switch cut short from here is finished at the next start.
        do { try store.setWipePending(true) } catch {
            if !failed.contains(Self.storeFailure) { failed.append(Self.storeFailure) }
        }
        var left = parts.count
        var stopped = false
        for part in parts {
            var finished = false
            let done: (Error?) -> Void = { [self] error in
                // A second answer from the same drop counts for nothing.
                if finished { return }
                finished = true
                if error != nil { failed.append(part.name) }
                left -= 1
                if left == 0 { stopped = !finish(target, failed) }
            }
            do { try part.drop(done) } catch { done(error) }
        }
        return !stopped
    }

    /// Every drop has finished: open `target`, or stop. Returns false if the switch stopped.
    private func finish(_ target: Mode, _ dropped: [String]) -> Bool {
        var failed = dropped
        if target == .instructor && failed.isEmpty {
            do { try store.write(Mode.instructor.stored) } catch { failed.append(Self.storeFailure) }
        }
        if !failed.isEmpty {
            effects.fatal(failed)
            return false
        }
        // Every part is dropped: the next start need not wipe. If this write fails, it only wipes again.
        try? store.setWipePending(false)
        current = target
        effects.open(target)
        if target == .rider { askAgain() }
        return true
    }
}
