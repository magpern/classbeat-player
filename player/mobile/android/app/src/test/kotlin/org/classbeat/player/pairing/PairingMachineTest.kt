package org.classbeat.player.pairing

import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.Secrets
import org.classbeat.player.pairing.PairingMachine.Effect
import org.classbeat.player.pairing.PairingMachine.Event
import org.classbeat.player.pairing.PairingMachine.Notice
import org.classbeat.player.pairing.PairingMachine.State
import org.classbeat.player.pairing.PairingProtocol.Poll
import org.classbeat.player.pairing.PairingProtocol.Start
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingMachineTest {
    private val started = Start.Started(Secrets.deviceCode(), "BCDF-GHJK", "$ORIGIN/pair", 600_000, 5_000)

    private fun waiting(now: Long = 0): State.Waiting {
        val s = PairingMachine.step(PairingMachine.INITIAL, Event.Begin(ORIGIN, true), now).state
        return PairingMachine.step(s, Event.Started(1, started), now).state as State.Waiting
    }

    @Test
    fun `waiting polls after the interval and the margin, one poll at a time`() {
        val step = PairingMachine.step(State.Starting(1, ORIGIN), Event.Started(1, started), 0)
        // The code arrives and only the wake is asked for: the page opens on "Open the site" alone (#944).
        assertEquals(listOf(Effect.Wake(1, 5_000 + PairingMachine.POLL_MARGIN_MS)), step.effects)
        val polling = PairingMachine.step(step.state, Event.PollDue(1), 5_500).state
        assertEquals(polling, PairingMachine.step(polling, Event.PollDue(1), 6_000).state)
    }

    @Test
    fun `slow_down adds five seconds and pending keeps the interval`() {
        val polling = PairingMachine.step(waiting(), Event.PollDue(1), 0).state
        val slow = PairingMachine.step(polling, Event.Polled(1, ORIGIN, Poll.Refused(PairingProtocol.SLOW_DOWN)), 0)
        assertEquals(Effect.Wake(1, 10_000 + PairingMachine.POLL_MARGIN_MS), slow.effects.single())
        val again = PairingMachine.step(slow.state, Event.PollDue(1), 0).state
        val pending = PairingMachine.step(again, Event.Polled(1, ORIGIN, Poll.Refused(PairingProtocol.PENDING)), 0)
        assertEquals(Effect.Wake(1, 10_000 + PairingMachine.POLL_MARGIN_MS), pending.effects.single())
    }

    @Test
    fun `denied, ran out and an unknown refusal end the attempt with their notice`() {
        val cases = mapOf(PairingProtocol.DENIED to Notice.DENIED, PairingProtocol.EXPIRED to Notice.CODE_EXPIRED, "x" to Notice.UNEXPECTED)
        for ((code, notice) in cases) {
            val polling = PairingMachine.step(waiting(), Event.PollDue(1), 0).state
            assertEquals(State.Unpaired(1, notice), PairingMachine.step(polling, Event.Polled(1, ORIGIN, Poll.Refused(code)), 0).state)
        }
        assertEquals(State.Unpaired(1, Notice.CODE_EXPIRED), PairingMachine.step(waiting(), Event.PollDue(1), 600_000).state)
    }

    @Test
    fun `a token nobody waits for is given back, never kept`() {
        val cancelled = PairingMachine.step(PairingMachine.step(waiting(), Event.PollDue(1), 0).state, Event.Unpair, 0)
        assertEquals(State.Unpaired(2, null), cancelled.state)
        val late = PairingMachine.step(cancelled.state, Event.Polled(1, ORIGIN, Poll.Ok(Secrets.token(), null)), 0)
        assertEquals(cancelled.state, late.state)
        val revoke = late.effects.single() as Effect.Revoke
        assertEquals(Secrets.token(), revoke.record.token)
    }

    @Test
    fun `a failed save forgets and gives back`() {
        val polling = PairingMachine.step(waiting(), Event.PollDue(1), 0).state
        val paired = PairingMachine.step(polling, Event.Polled(1, ORIGIN, Poll.Ok(Secrets.token(), null)), 0)
        assertTrue(paired.effects.single() is Effect.Save)
        val failed = PairingMachine.step(paired.state, Event.Saved(1, false), 0)
        assertEquals(State.Unpaired(1, Notice.SAVE_FAILED), failed.state)
        assertEquals(Effect.Forget, failed.effects[0])
        assertTrue(failed.effects[1] is Effect.Revoke)
    }

    @Test
    fun `a pair again's new token is saved and the expired one given back, never kept`() {
        val expired = State.Paired(1, PairingRecord(ORIGIN, Secrets.token(), null), null, true)
        val begin = PairingMachine.step(expired, Event.Begin(ORIGIN, true), 0)
        val code = PairingMachine.step(begin.state, Event.Started(2, started), 0)
        val polling = PairingMachine.step(code.state, Event.PollDue(2), 5_500).state
        val ok = PairingMachine.step(polling, Event.Polled(2, ORIGIN, Poll.Ok(Secrets.token('C'), null)), 5_600)
        val record = PairingRecord(ORIGIN, Secrets.token('C'), null)
        assertEquals(State.Paired(2, record, null, false), ok.state)
        assertEquals(listOf(Effect.Save(2, record), Effect.Revoke(expired.record)), ok.effects)
        // A first pairing has nothing to give back.
        val first = PairingMachine.step(PairingMachine.step(waiting(), Event.PollDue(1), 0).state, Event.Polled(1, ORIGIN, Poll.Ok(Secrets.token(), null)), 0)
        assertTrue(first.effects.single() is Effect.Save)
    }

    @Test
    fun `begin is ignored while pairing or paired, and allowed when expired`() {
        val record = PairingRecord(ORIGIN, Secrets.token(), null)
        val live = State.Paired(1, record, null, false)
        assertEquals(live, PairingMachine.step(live, Event.Begin(ORIGIN, true), 0).state)
        val w = waiting()
        assertEquals(w, PairingMachine.step(w, Event.Begin(ORIGIN, true), 0).state)
        val expired = State.Paired(1, record, null, true)
        val again = PairingMachine.step(expired, Event.Begin(ORIGIN, true), 0)
        assertEquals(State.Starting(2, ORIGIN, expired), again.state)
        // No Keystore on a pair again: the expired pairing stays, with the reason.
        assertEquals(expired.copy(attempt = 2, notice = Notice.NO_KEYSTORE), PairingMachine.step(expired, Event.Begin(ORIGIN, false), 0).state)
    }

    @Test
    fun `no step of a pairing opens the page by itself`() {
        // Every effect a whole pairing asks for, from Begin to the saved token, is one the machine
        // has a reason for; none is about the page (docs/design/app-pairing.md, item 5).
        val begin = PairingMachine.step(PairingMachine.INITIAL, Event.Begin(ORIGIN, true), 0)
        val code = PairingMachine.step(begin.state, Event.Started(1, started), 0)
        val poll = PairingMachine.step(code.state, Event.PollDue(1), 5_500)
        val pending = PairingMachine.step(poll.state, Event.Polled(1, ORIGIN, Poll.Refused(PairingProtocol.PENDING)), 5_600)
        val again = PairingMachine.step(pending.state, Event.PollDue(1), 11_100)
        val ok = PairingMachine.step(again.state, Event.Polled(1, ORIGIN, Poll.Ok(Secrets.token(), null)), 11_200)
        val kinds = listOf(begin, code, poll, pending, again, ok).flatMap { it.effects }.map { it::class.simpleName }
        assertEquals(listOf("StartCall", "Wake", "PollCall", "Wake", "PollCall", "Save"), kinds)
    }

    @Test
    fun `a stale answer for an older attempt changes nothing`() {
        val s = State.Starting(3, ORIGIN)
        assertEquals(s, PairingMachine.step(s, Event.Started(2, started), 0).state)
        assertEquals(s, PairingMachine.step(s, Event.Checked(2, PairingProtocol.Device.Gone), 0).state)
    }
}
