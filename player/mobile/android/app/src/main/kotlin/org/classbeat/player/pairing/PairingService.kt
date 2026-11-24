package org.classbeat.player.pairing

import org.classbeat.player.backend.BackendTransport
import org.classbeat.player.backend.Calls
import org.classbeat.player.pairing.PairingMachine.Effect
import org.classbeat.player.pairing.PairingMachine.Event
import org.classbeat.player.pairing.PairingMachine.State
import org.classbeat.player.pairing.PairingProtocol.Device

/** What the pairing needs from the device, each one small enough to fake in a test. */
interface PairingPorts {
    fun now(): Long

    /** Runs [run] once, on the main thread, at [time] (a later call for the same pairing replaces nothing: the machine ignores stale wakes). */
    fun at(time: Long, run: () -> Unit)

    /** Opens the pairing page in the system browser or a Custom Tab, never in the app's web view. False when none could open it. */
    fun openPage(page: String): Boolean

    /** Deletes every cached class: the pairing that fetched them is gone. */
    fun forgetCache()
}

/** What a screen may show of the pairing: never the token, never the device code. */
sealed class PairingView {
    data class Unpaired(val notice: PairingMachine.Notice?) : PairingView()

    object Starting : PairingView()

    data class Waiting(val userCode: String, val page: String, val expiresAt: Long) : PairingView()

    /** [notice] says why a "pair again" ended without a new pairing. */
    data class Paired(val email: String?, val deviceName: String?, val expired: Boolean, val notice: PairingMachine.Notice?) : PairingView()
}

/**
 * Runs [PairingMachine] against the device (ADR 0011 §5): the transport, the Keystore-backed store,
 * the timer and the browser. Pure: every side effect goes through a port. Not thread-safe: called
 * on the main thread only, and the transport and the timer answer there.
 *
 * [origin] is the backend fixed in the build (null when the build holds none it may call); a stored
 * record from any other backend is deleted, never used.
 */
class PairingService(
    private val origin: String?,
    private val allowLoopbackHttp: Boolean,
    private val version: String,
    private val transport: BackendTransport,
    private val store: SecretStore,
    private val ports: PairingPorts,
) {
    var state: State = PairingMachine.INITIAL
        private set

    /** After every change, for the screen. */
    var changed: () -> Unit = {}

    /** The token was deleted (unpaired here, revoked or unknown on the site): instructor mode closes. */
    var forgotten: () -> Unit = {}

    private val queue = ArrayDeque<Event>()
    private var running = false

    /** Reads the stored pairing once, at start. A record that cannot be read or is for another backend is deleted. */
    fun load() {
        val text = store.load()
        val record = text?.let { PairingRecord.parse(it, allowLoopbackHttp) }?.takeIf { it.origin == origin }
        if (text != null && record == null) {
            store.delete()
            ports.forgetCache()
        }
        dispatch(Event.Loaded(record))
    }

    /** Pair, or pair again after the token expired. */
    fun begin() = dispatch(Event.Begin(origin, store.available()))

    /** Unpair when paired; Cancel while pairing. */
    fun unpair() = dispatch(Event.Unpair)

    /** Cancel (or Back) on a pairing screen: stops an attempt, never ends a pairing held. */
    fun cancel() {
        if (state is State.Starting || state is State.Waiting) dispatch(Event.Unpair)
    }

    /** A player call was refused with a 401 that ends or pauses the pairing (sync, list). */
    fun refused(refusal: PairingProtocol.Refusal) {
        val s = state as? State.Paired ?: return
        dispatch(Event.Checked(s.attempt, if (refusal == PairingProtocol.Refusal.GONE) Device.Gone else Device.Expired))
    }

    /** Whether a pairing is held, expired or not: instructor mode may open, and shows "pair again" when expired. */
    fun paired(): Boolean = state is State.Paired

    /** The record to call the backend with: paired, not expired, and for the build's backend. Null otherwise. */
    fun credential(): PairingRecord? {
        val s = state as? State.Paired ?: return null
        return s.record.takeIf { !s.expired && it.origin == origin }
    }

    /** Every secret this phone holds now, for the answer guard: the token and the device code. */
    fun secrets(): List<String> = when (val s = state) {
        is State.Paired -> listOf(s.record.token)
        is State.Waiting -> listOf(s.deviceCode)
        else -> emptyList()
    }

    fun view(): PairingView = when (val s = state) {
        is State.Unpaired -> PairingView.Unpaired(s.notice)
        is State.Starting -> PairingView.Starting
        is State.Waiting -> PairingView.Waiting(s.userCode, s.page, s.expiresAt)
        is State.Paired -> PairingView.Paired(s.record.email, s.deviceName, s.expired, s.notice)
    }

    /** Events queue: an effect that answers at once (the store) never re-enters the machine. */
    private fun dispatch(event: Event) {
        queue.addLast(event)
        if (running) return
        running = true
        try {
            while (queue.isNotEmpty()) {
                val step = PairingMachine.step(state, queue.removeFirst(), ports.now())
                state = step.state
                step.effects.forEach(::run)
                changed()
            }
        } finally {
            running = false
        }
    }

    private fun run(effect: Effect) {
        when (effect) {
            is Effect.StartCall -> transport.send(Calls.pairingStart(effect.origin, version)) {
                dispatch(Event.Started(effect.attempt, PairingProtocol.parseStart(it, effect.origin)))
            }
            // No browser: the screen still shows the code and the address, to type in on another device.
            is Effect.OpenPage -> ports.openPage(effect.page)
            is Effect.Wake -> ports.at(effect.at) { dispatch(Event.PollDue(effect.attempt)) }
            is Effect.PollCall -> transport.send(Calls.pairingToken(effect.origin, effect.deviceCode)) {
                dispatch(Event.Polled(effect.attempt, effect.origin, PairingProtocol.parsePoll(it)))
            }
            is Effect.Save -> queue.addLast(Event.Saved(effect.attempt, store.save(effect.record.text())))
            is Effect.Check -> transport.send(Calls.device(effect.record.origin, effect.record.token)) {
                dispatch(Event.Checked(effect.attempt, PairingProtocol.parseDevice(it)))
            }
            Effect.Forget -> {
                store.delete()
                ports.forgetCache()
                forgotten()
            }
            // Given back to the backend; its answer changes nothing here.
            is Effect.Revoke -> transport.send(Calls.revoke(effect.record.origin, effect.record.token)) {}
        }
    }
}
