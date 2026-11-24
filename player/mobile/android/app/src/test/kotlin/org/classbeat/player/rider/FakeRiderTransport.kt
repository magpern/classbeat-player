package org.classbeat.player.rider

import org.classbeat.player.backend.HttpAnswer

/** A rider transport in memory: the test answers each join and drives each link by hand. */
class FakeRiderTransport : RiderTransport {
    var joins = 0
        private set
    private val pending = ArrayDeque<(HttpAnswer) -> Unit>()
    val links = mutableListOf<Link>()

    override fun join(session: String, nickname: String, answer: (HttpAnswer) -> Unit) {
        joins++
        pending.addLast(answer)
    }

    /** Answers the oldest join still waiting. */
    fun answerJoin(answer: HttpAnswer) = pending.removeFirst()(answer)

    override fun open(listener: RiderLink.Listener): RiderLink = Link(listener).also { links += it }

    class Link(val listener: RiderLink.Listener) : RiderLink {
        val sent = mutableListOf<String>()
        var closed = false
            private set

        override fun send(text: String) {
            sent += text
        }

        override fun close() {
            closed = true
        }
    }
}
