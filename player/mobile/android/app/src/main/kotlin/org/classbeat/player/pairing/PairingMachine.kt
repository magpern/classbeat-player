package org.classbeat.player.pairing

import org.classbeat.player.pairing.PairingProtocol.Device
import org.classbeat.player.pairing.PairingProtocol.Poll
import org.classbeat.player.pairing.PairingProtocol.Start

/**
 * Pairing this phone (ADR 0002 §6, ADR 0011 §5), the desktop's `core/pairing/machine.ts` in
 * Kotlin: an event and the time in, the next state and the effects for the edge. Pure: no I/O, no
 * timers, no clock. The device code and the token live in this state, in native code; the page
 * gets only [PairingView], which holds neither.
 */
object PairingMachine {
    /** Why the phone is not paired, said once. The phone never shows `no_server` or `unpaired`. */
    enum class Notice { NO_SERVER, NO_KEYSTORE, TOO_MANY, UNREACHABLE, UNEXPECTED, DENIED, CODE_EXPIRED, SAVE_FAILED, REVOKED_ON_SITE, UNPAIRED }

    sealed class State {
        abstract val attempt: Int

        data class Unpaired(override val attempt: Int, val notice: Notice?) : State()

        /** [back] is the expired pairing a "pair again" started from: kept, and returned to if this one ends. */
        data class Starting(override val attempt: Int, val origin: String, val back: Paired? = null) : State()

        class Waiting(
            override val attempt: Int,
            val origin: String,
            val deviceCode: String,
            val userCode: String,
            val page: String,
            val expiresAt: Long,
            val intervalMs: Long,
            /** True while a poll is out: never two at once. */
            val polling: Boolean,
            val back: Paired? = null,
        ) : State() {
            fun copy(intervalMs: Long = this.intervalMs, polling: Boolean = this.polling) =
                Waiting(attempt, origin, deviceCode, userCode, page, expiresAt, intervalMs, polling, back)

            override fun toString() = "Waiting($attempt, $userCode, polling=$polling)"
        }

        /** [notice] says why a "pair again" ended without a new pairing; the expired one is still held. */
        data class Paired(
            override val attempt: Int,
            val record: PairingRecord,
            val deviceName: String?,
            val expired: Boolean,
            val notice: Notice? = null,
        ) : State()
    }

    sealed class Effect {
        data class StartCall(val attempt: Int, val origin: String) : Effect()

        /** Send [Event.PollDue] for this attempt at [at] (the edge's one timer). */
        data class Wake(val attempt: Int, val at: Long) : Effect()

        class PollCall(val attempt: Int, val origin: String, val deviceCode: String) : Effect() {
            override fun toString() = "PollCall($attempt)"
        }

        data class Save(val attempt: Int, val record: PairingRecord) : Effect()

        data class Check(val attempt: Int, val record: PairingRecord) : Effect()

        object Forget : Effect()

        data class Revoke(val record: PairingRecord) : Effect()
    }

    sealed class Event {
        data class Loaded(val record: PairingRecord?) : Event()

        /** [origin] is null when the build holds none this build may call. */
        data class Begin(val origin: String?, val keystore: Boolean) : Event()

        data class Started(val attempt: Int, val answer: Start) : Event()

        data class PollDue(val attempt: Int) : Event()

        /** [origin] is where the poll went, so a token nobody waits for can be given back to it. */
        data class Polled(val attempt: Int, val origin: String, val answer: Poll) : Event()

        data class Saved(val attempt: Int, val ok: Boolean) : Event()

        data class Checked(val attempt: Int, val answer: Device) : Event()

        /** Unpair when paired; Cancel while starting or waiting. */
        object Unpair : Event()

        /** The notice was shown and the screen left: it is not shown again. */
        object Seen : Event()
    }

    data class Step(val state: State, val effects: List<Effect> = emptyList())

    /** The backend's interval is exact; each poll goes this much later so it is never early. */
    const val POLL_MARGIN_MS = 500L

    /** RFC 8628 §3.5: each `slow_down` adds 5 seconds. */
    const val SLOW_DOWN_STEP_MS = 5000L
    const val MAX_INTERVAL_MS = 60_000L

    val INITIAL: State = State.Unpaired(0, null)

    private fun unpaired(attempt: Int, notice: Notice?, effects: List<Effect> = emptyList()) = Step(State.Unpaired(attempt, notice), effects)

    /**
     * A pairing attempt ended without a token. A "pair again" goes back to the expired pairing it
     * started from (its cached classes still play); a first pairing to unpaired.
     */
    private fun ended(s: State, attempt: Int, notice: Notice?): Step {
        val back = (s as? State.Starting)?.back ?: (s as? State.Waiting)?.back
        return if (back == null) unpaired(attempt, notice) else Step(back.copy(attempt = attempt, notice = notice))
    }

    /** The next poll, after [waitMs] and the margin, but never past the pairing's end. */
    private fun wait(s: State.Waiting, now: Long, waitMs: Long): Step {
        val at = minOf(now + waitMs + POLL_MARGIN_MS, s.expiresAt)
        return Step(s.copy(polling = false), listOf(Effect.Wake(s.attempt, at)))
    }

    private fun polled(s: State.Waiting, answer: Poll, now: Long): Step =
        when (answer) {
            is Poll.Ok -> {
                val record = PairingRecord(s.origin, answer.token, answer.email)
                Step(State.Paired(s.attempt, record, null, false), listOf(Effect.Save(s.attempt, record)))
            }
            is Poll.Retry -> wait(s, now, maxOf(s.intervalMs, minOf(answer.afterMs ?: 0L, MAX_INTERVAL_MS)))
            is Poll.Unexpected -> ended(s, s.attempt, Notice.UNEXPECTED)
            is Poll.Refused -> when (answer.code) {
                PairingProtocol.PENDING -> wait(s, now, s.intervalMs)
                PairingProtocol.SLOW_DOWN -> {
                    val interval = minOf(s.intervalMs + SLOW_DOWN_STEP_MS, MAX_INTERVAL_MS)
                    wait(s.copy(intervalMs = interval), now, interval)
                }
                PairingProtocol.DENIED -> ended(s, s.attempt, Notice.DENIED)
                PairingProtocol.EXPIRED -> ended(s, s.attempt, Notice.CODE_EXPIRED)
                else -> ended(s, s.attempt, Notice.UNEXPECTED)
            }
        }

    private fun started(s: State.Starting, answer: Start, now: Long): Step {
        val ok = when (answer) {
            is Start.Started -> answer
            Start.TooMany -> return ended(s, s.attempt, Notice.TOO_MANY)
            Start.Unreachable -> return ended(s, s.attempt, Notice.UNREACHABLE)
            Start.Unexpected -> return ended(s, s.attempt, Notice.UNEXPECTED)
        }
        // The page is not opened here: the code shows first, and only "Open the site" opens the page
        // (docs/design/app-pairing.md, item 5), so it can be compared or typed on another device.
        val waiting = State.Waiting(s.attempt, s.origin, ok.deviceCode, ok.userCode, ok.page, now + ok.expiresInMs, ok.intervalMs, false, s.back)
        return wait(waiting, now, waiting.intervalMs)
    }

    /**
     * A token that arrives when nothing waits for it (after Cancel, or for an older attempt) is never
     * kept and never shown: it is given back to the backend that issued it, as a failed save is. The
     * one exception is the token this state already holds.
     */
    private fun late(s: State, origin: String, answer: Poll.Ok): Step {
        if (s is State.Paired && s.record.token == answer.token) return Step(s)
        return Step(s, listOf(Effect.Revoke(PairingRecord(origin, answer.token, answer.email))))
    }

    fun step(s: State, e: Event, now: Long): Step =
        when (e) {
            is Event.Loaded ->
                if (s !is State.Unpaired || s.attempt != 0 || e.record == null) Step(s)
                else Step(State.Paired(1, e.record, null, false), listOf(Effect.Check(1, e.record)))
            is Event.Begin -> begin(s, e)
            is Event.Started -> if (s is State.Starting && s.attempt == e.attempt) started(s, e.answer, now) else Step(s)
            is Event.PollDue -> when {
                s !is State.Waiting || s.attempt != e.attempt || s.polling -> Step(s)
                now >= s.expiresAt -> ended(s, s.attempt, Notice.CODE_EXPIRED)
                else -> Step(s.copy(polling = true), listOf(Effect.PollCall(s.attempt, s.origin, s.deviceCode)))
            }
            is Event.Polled ->
                if (s is State.Waiting && s.attempt == e.attempt && s.polling) polled(s, e.answer, now)
                else if (e.answer is Poll.Ok) late(s, e.origin, e.answer)
                else Step(s)
            is Event.Saved ->
                if (s !is State.Paired || s.attempt != e.attempt || e.ok) Step(s)
                // The token could not be kept: it is given back, so no device row waits for a holder, and
                // whatever the store still holds (an older pairing, after a "pair again") is deleted too.
                else unpaired(s.attempt, Notice.SAVE_FAILED, listOf(Effect.Forget, Effect.Revoke(s.record)))
            is Event.Checked -> checked(s, e)
            Event.Seen -> if (s is State.Unpaired && s.notice != null) Step(s.copy(notice = null)) else Step(s)
            Event.Unpair -> when (s) {
                is State.Unpaired -> Step(s)
                // Deleted here first, then given back to the backend; offline, it is deleted all the same.
                is State.Paired -> unpaired(s.attempt + 1, Notice.UNPAIRED, listOf(Effect.Forget, Effect.Revoke(s.record)))
                else -> ended(s, s.attempt + 1, null)
            }
        }

    private fun begin(s: State, e: Event.Begin): Step {
        // A working pairing is ended with Unpair first; one the backend no longer takes may pair again.
        if (s is State.Starting || s is State.Waiting || (s is State.Paired && !s.expired)) return Step(s)
        val attempt = s.attempt + 1
        val back = (s as? State.Paired)?.copy(notice = null)
        if (e.origin == null) return ended(State.Starting(attempt, "", back), attempt, Notice.NO_SERVER)
        // No Keystore, no pairing: the token is never kept where it could be read in the clear.
        if (!e.keystore) return ended(State.Starting(attempt, "", back), attempt, Notice.NO_KEYSTORE)
        return Step(State.Starting(attempt, e.origin, back), listOf(Effect.StartCall(attempt, e.origin)))
    }

    private fun checked(s: State, e: Event.Checked): Step {
        if (s !is State.Paired || s.attempt != e.attempt) return Step(s)
        return when (e.answer) {
            is Device.Ok -> Step(s.copy(deviceName = e.answer.name, expired = false))
            Device.Expired -> Step(s.copy(expired = true))
            // Revoked on the site or unknown to the backend: the token is deleted. A network error or
            // a server fault ("unknown") changes nothing.
            Device.Gone -> unpaired(s.attempt + 1, Notice.REVOKED_ON_SITE, listOf(Effect.Forget))
            Device.Unknown -> Step(s)
        }
    }
}
