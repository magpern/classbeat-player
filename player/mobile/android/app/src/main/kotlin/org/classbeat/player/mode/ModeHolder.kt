package org.classbeat.player.mode

import org.classbeat.player.policy.Mode
import org.classbeat.player.policy.ModePolicy

/** Native storage for the last mode used: the app's private preferences, which the web view cannot reach. */
interface ModeStore {
    fun read(): String?

    /** Writes the mode durably before returning; throws if it could not. */
    fun write(value: String)

    /** True while a switch's drops have started and not all finished: the next start wipes first. */
    fun wipePending(): Boolean

    /** Writes the flag durably before returning; throws if it could not. */
    fun setWipePending(pending: Boolean)
}

/** What the holder asks the device. Read again at every decision, never cached. */
interface Device {
    val paired: Boolean
    val secureLock: Boolean
}

/**
 * One thing a switch drops (ModePolicy.TEARDOWN names them). [drop] starts the drop and calls its
 * `done` once it has finished, with null, or with what went wrong; it may also throw. A drop that
 * finishes later (the web view's storage) holds the switch until it does.
 */
class Teardown(val name: String, val drop: (done: (Throwable?) -> Unit) -> Unit)

/** What the holder has the screen and the bridge do. The Android edge implements it (ModeController). */
interface ModeEffects {
    /** Takes every intent off the bridge: the page can call nothing until [open]. */
    fun closeBridge()

    /** Loads [mode]'s start page fresh, and puts its intents, and only those, on the bridge once no other page is left (PageOpener). */
    fun open(mode: Mode)

    /** Opens the system's screen-lock confirmation; its answer comes back through [ModeHolder.lockAnswered]. */
    fun askLock()

    /** The native "A screen lock is needed" screen. */
    fun showNoLock()

    /** The native "Switch to rider mode?" question. */
    fun askRiderQuestion()

    /** The native switching screen while the switch to [mode] runs. */
    fun showSwitching(mode: Mode)

    /** A part could not be dropped: the app stops rather than show a page with it left. */
    fun fatal(failed: List<String>)
}

/**
 * Holds the app's mode (ADR 0011 section 1, issue #630). Only native code calls it; nothing the
 * page sends can select, change or unlock a mode. Not thread-safe: the edge calls it on the main
 * thread only.
 */
class ModeHolder(
    private val store: ModeStore,
    private val device: Device,
    private val effects: ModeEffects,
    private val parts: List<Teardown>,
) {
    init {
        require(parts.map { it.name } == ModePolicy.TEARDOWN) { "teardown parts are not ModePolicy.TEARDOWN" }
    }

    /** The name [ModeEffects.fatal] gets when the mode could not be written. */
    companion object {
        const val STORE = "store"
    }

    /** What the holder is waiting for, if anything. */
    enum class Pending { LOCK, NO_LOCK, RIDER_QUESTION }

    /** The mode the app is in; null while it is between modes, when every intent is refused. */
    var current: Mode? = null
        private set

    var pending: Pending? = null
        private set

    /** Whether "Switch to instructor mode" goes to pairing or to the screen lock, for the strip's lead line. */
    val paired: Boolean get() = device.paired

    val secureLock: Boolean get() = device.secureLock

    /**
     * Opens the app in rider mode and loads its start page. When the last mode used was instructor
     * mode (ModePolicy.startMode: still paired, with a secure lock), the screen lock is asked again
     * at once, as for any entry from rider mode (ADR 0011 section 1): a reopen never skips it, and
     * nothing of instructor mode shows before it passes. A switch the app was stopped in the middle
     * of (killed while the storage wipe ran) is finished first: every part is dropped again before
     * any page loads, so nothing the last page left survives.
     */
    fun start() {
        reask = ModePolicy.startMode(store.read(), device.paired, device.secureLock) == Mode.INSTRUCTOR
        if (store.wipePending()) {
            switchTo(Mode.RIDER)
            return
        }
        // Written back so a value that did not open instructor mode is gone; the lock writes it again.
        store.write(Mode.RIDER.stored)
        current = Mode.RIDER
        effects.open(Mode.RIDER)
        askAgain()
    }

    /** The app reopened toward instructor mode: the lock is asked once rider mode is open. */
    private var reask = false

    private fun askAgain() {
        if (!reask) return
        reask = false
        // Lost the pairing or the lock meanwhile: the app simply stays in rider mode.
        if (ModePolicy.entry(device.paired, device.secureLock) != ModePolicy.Entry.ASK_LOCK) return
        pending = Pending.LOCK
        effects.askLock()
    }

    /**
     * The pairing ended (unpaired here, or revoked on the website): instructor mode closes at once,
     * with no question, as any switch does. Elsewhere nothing changes.
     */
    fun unpaired() {
        if (current != Mode.INSTRUCTOR) return
        pending = null
        switchTo(Mode.RIDER)
    }

    /** "Switch to instructor mode" in rider mode. Returns the way it went, or null if refused. */
    fun askInstructor(): ModePolicy.Entry? {
        if (current != Mode.RIDER || pending != null) return null
        val entry = ModePolicy.entry(device.paired, device.secureLock)
        when (entry) {
            ModePolicy.Entry.PAIR -> Unit
            ModePolicy.Entry.NO_LOCK -> {
                pending = Pending.NO_LOCK
                effects.showNoLock()
            }
            ModePolicy.Entry.ASK_LOCK -> {
                pending = Pending.LOCK
                effects.askLock()
            }
        }
        return entry
    }

    /** The system screen-lock prompt answered. Returns true if instructor mode opened. */
    fun lockAnswered(passed: Boolean): Boolean {
        val asked = pending == Pending.LOCK && current == Mode.RIDER
        if (pending == Pending.LOCK) pending = null
        if (!ModePolicy.opensInstructor(asked, passed, device.paired, device.secureLock)) return false
        return switchTo(Mode.INSTRUCTOR)
    }

    /** Back from Android's security settings, or the app came back while the no-lock screen showed. */
    fun noLockReturned() {
        if (pending != Pending.NO_LOCK) return
        pending = null
        askInstructor()
    }

    /** "Stay in rider mode" (or Back) on the no-lock screen. */
    fun noLockStay() {
        if (pending == Pending.NO_LOCK) pending = null
    }

    /** "Switch to rider mode" in instructor mode. Returns false if refused. */
    fun askRider(): Boolean {
        if (current != Mode.INSTRUCTOR || pending != null) return false
        pending = Pending.RIDER_QUESTION
        effects.askRiderQuestion()
        return true
    }

    /** The question answered: "Switch" is [switch] true; "Stay", Back or leaving the app is false. */
    fun riderAnswered(switch: Boolean): Boolean {
        if (pending != Pending.RIDER_QUESTION) return false
        pending = null
        if (!switch || current != Mode.INSTRUCTOR) return false
        return switchTo(Mode.RIDER)
    }

    /**
     * Rider mode is written first, so a switch cut short opens in rider mode next time; instructor
     * mode only after everything was dropped. Every part is dropped in both directions, and the
     * page opens only once every drop has finished; if any fails the page is not opened and the app
     * stops. Returns false if the switch stopped; true if it opened or is still dropping.
     */
    private fun switchTo(target: Mode): Boolean {
        current = null
        effects.closeBridge()
        effects.showSwitching(target)
        val failed = mutableListOf<String>()
        if (target == Mode.RIDER) runCatching { store.write(Mode.RIDER.stored) }.onFailure { failed += STORE }
        // Before the first drop: a switch cut short from here is finished at the next start.
        runCatching { store.setWipePending(true) }.onFailure { if (STORE !in failed) failed += STORE }
        var left = parts.size
        var stopped = false
        parts.forEach { part ->
            var finished = false
            val done = { error: Throwable? ->
                // A second answer from the same drop counts for nothing.
                if (!finished) {
                    finished = true
                    if (error != null) failed += part.name
                    left -= 1
                    if (left == 0) stopped = !finish(target, failed)
                }
            }
            runCatching { part.drop(done) }.onFailure(done)
        }
        return !stopped
    }

    /** Every drop has finished: open [target], or stop. Returns false if the switch stopped. */
    private fun finish(target: Mode, failed: MutableList<String>): Boolean {
        if (target == Mode.INSTRUCTOR && failed.isEmpty()) {
            runCatching { store.write(Mode.INSTRUCTOR.stored) }.onFailure { failed += STORE }
        }
        if (failed.isNotEmpty()) {
            effects.fatal(failed)
            return false
        }
        // Every part is dropped: the next start need not wipe. If this write fails, it only wipes again.
        runCatching { store.setWipePending(false) }
        current = target
        effects.open(target)
        if (target == Mode.RIDER) askAgain()
        return true
    }
}
