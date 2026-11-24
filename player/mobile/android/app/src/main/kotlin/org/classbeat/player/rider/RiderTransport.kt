package org.classbeat.player.rider

import org.classbeat.player.backend.HttpAnswer

/**
 * How rider mode reaches the live process (ADR 0011 sections 1 and 3, issue #633), as a contract:
 * the join request and the rider's live link, with the link's open, send and close. Pure: the I/O
 * lives in an implementation.
 *
 * An implementation calls only the backend origin fixed in the build and its live paths, sends what
 * it is given and nothing else, never follows a redirect, never throws and never logs. It answers
 * on the main thread, later, never from inside the call that started it. Every failure is
 * [HttpAnswer.Unreachable] for the join, and [RiderLink.Listener.closed] with [CLOSE_LOST] for the
 * link.
 *
 * The real transport is not built yet (#649). The app wires [OfflineRiderTransport]; tests use a
 * fake.
 */
interface RiderTransport {
    /** `POST /api/live/join` with exactly `{session, nickname}`. */
    fun join(session: String, nickname: String, answer: (HttpAnswer) -> Unit)

    /** Opens the rider's live link. The listener hears of it only after this returns. */
    fun open(listener: RiderLink.Listener): RiderLink

    companion object {
        /** The close code for a link that was lost or never opened (no close frame came). */
        const val CLOSE_LOST = 1006
    }
}

/** One open (or opening) live link. After [close] its listener hears nothing more. */
interface RiderLink {
    /** Sends one text frame. */
    fun send(text: String)

    /** Closes the link; no event follows. */
    fun close()

    interface Listener {
        fun opened()

        fun text(frame: String)

        fun closed(code: Int)
    }
}

/** The stand-in the app runs until the real transport exists: every join and every link is offline. */
class OfflineRiderTransport(private val post: (Runnable) -> Unit) : RiderTransport {
    override fun join(session: String, nickname: String, answer: (HttpAnswer) -> Unit) {
        post(Runnable { answer(HttpAnswer.Unreachable) })
    }

    override fun open(listener: RiderLink.Listener): RiderLink {
        val link = OfflineLink()
        post(Runnable { if (!link.shut) listener.closed(RiderTransport.CLOSE_LOST) })
        return link
    }

    private class OfflineLink : RiderLink {
        var shut = false

        override fun send(text: String) = Unit

        override fun close() {
            shut = true
        }
    }
}
