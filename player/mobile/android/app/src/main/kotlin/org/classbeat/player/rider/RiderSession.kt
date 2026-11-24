package org.classbeat.player.rider

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.backend.Json
import org.classbeat.player.policy.AnswerPolicy

/** One answer or event for the page: a JSON object, or null for the one refused word. */
typealias RiderReply = (Map<String, Any?>?) -> Unit

/**
 * The rider's session in native code (ADR 0011 sections 1 and 3, issue #633). Pure: no Android, no
 * storage, no I/O of its own; the transport does that.
 *
 * The rider token lives here, in memory only, from the join's answer until the session ends: it is
 * never written anywhere, never in an answer or an event, and so never in the web view. Native code
 * builds `hello` with it itself. The page joins, opens the live link, waits for what comes in
 * ([receive], one call at a time) and leaves; it never sends a frame.
 *
 * The token is dropped when the rider leaves, the mode switches or the app goes ([drop]), the
 * session ends (`ended`) and the live process refuses the token or closes the session (the final
 * close codes). What comes in is checked against the rider-bound messages (schema/live/v1/
 * routing.json): anything else, a host event among them, never reaches the page.
 */
class RiderSession(private val transport: RiderTransport) {
    private var token: String? = null
    private var link: RiderLink? = null
    private var joining = false

    /** Bumped on every ending: an answer or a link event from before it is stale. */
    private var generation = 0
    private val queue = ArrayDeque<Map<String, Any?>>()
    private var waiting: RiderReply? = null

    /** Told whenever [joined] may have changed (the hardware Back follows it). */
    var changed: () -> Unit = {}

    /** A token is held: the rider is in a class, or getting back in. */
    val joined: Boolean get() = token != null

    /** `POST /api/live/join`. The page hears joined, unreachable, or the server's status and error word. */
    fun join(session: String, nickname: String, reply: RiderReply) {
        if (joined || joining || !SESSION.matches(session) || !nicknameFits(nickname)) return reply(null)
        joining = true
        val gen = generation
        transport.join(session, nickname) { answer ->
            if (gen != generation) return@join reply(null)
            joining = false
            reply(answerOf(answer))
        }
    }

    /** Opens the live link with the token held. Its events come through [receive]. */
    fun open(reply: RiderReply) {
        if (!joined || link != null) return reply(null)
        val gen = generation
        var opened: RiderLink? = null
        opened = transport.open(object : RiderLink.Listener {
            private fun live() = gen == generation && link === opened

            override fun opened() {
                val t = token
                if (!live() || t == null) return
                opened?.send(hello(t))
                push(mapOf("kind" to "opened"))
            }

            override fun text(frame: String) {
                if (live()) inbound(frame)
            }

            override fun closed(code: Int) {
                if (!live()) return
                link = null
                push(mapOf("kind" to "closed", "code" to code))
                if (code in FINAL) end()
            }
        })
        link = opened
        reply(mapOf("result" to "opening"))
    }

    /** The next event, at once if one waits, else when one comes. One call at a time. */
    fun receive(reply: RiderReply) {
        if (waiting != null) return reply(null)
        val next = queue.removeFirstOrNull()
        when {
            next != null -> deliver(next, reply)
            joined -> waiting = reply
            else -> reply(null)
        }
    }

    /** The rider's "Leave": the link closes and the token goes. */
    fun leave(reply: RiderReply) {
        drop()
        reply(mapOf("result" to "left"))
    }

    /** Back while joined: the page asks "Leave the class?". */
    fun backPressed() {
        if (joined) push(mapOf("kind" to "back"))
    }

    /** Ends everything: on leave, on a mode switch and when the app goes. The waiting call is refused. */
    fun drop() {
        end()
        queue.clear()
        joining = false
        waiting?.invoke(null)
        waiting = null
    }

    private fun end() {
        generation++
        link?.close()
        link = null
        token = null
        changed()
    }

    private fun inbound(frame: String) {
        if (frame.length > MAX_FRAME_CHARS || !riderBound(frame)) return
        push(mapOf("kind" to "frame", "text" to frame))
        // The session is over: the token goes now, and the page shows the ending it was sent.
        if ((Json.tryParse(frame).getOrNull() as? Map<*, *>)?.get("type") == "ended") end()
    }

    private fun push(event: Map<String, Any?>) {
        if (!AnswerPolicy.mayAnswer(event, listOfNotNull(token))) return
        val w = waiting
        if (w != null) {
            waiting = null
            return deliver(event, w)
        }
        if (queue.size >= MAX_QUEUED) {
            // A full queue loses its oldest passing event, never an ending (a close or `ended`): the
            // page must still hear how the class ended. With none to lose, a passing event is not kept.
            val old = queue.indexOfFirst { !terminal(it) }
            if (old >= 0) queue.removeAt(old) else if (!terminal(event)) return
        }
        queue.addLast(event)
    }

    /** A close of the link, or the class's `ended`: what the page must hear to show the ending. */
    private fun terminal(event: Map<String, Any?>): Boolean =
        event["kind"] == "closed" || (event["kind"] == "frame" && (Json.tryParse(event["text"] as? String ?: "").getOrNull() as? Map<*, *>)?.get("type") == "ended")

    private fun deliver(event: Map<String, Any?>, reply: RiderReply) =
        reply(if (AnswerPolicy.mayAnswer(event, listOfNotNull(token))) event else null)

    private fun answerOf(answer: HttpAnswer): Map<String, Any?>? = when (answer) {
        HttpAnswer.Unreachable -> mapOf("result" to "unreachable")
        is HttpAnswer.Http -> {
            val t = tokenIn(answer)
            if (t != null) {
                token = t
                changed()
                mapOf("result" to "joined")
            } else {
                // A 200 without a good token is "unexpected" to the page: no body goes with it.
                val body = if (answer.status == 200) null else errorWord(answer.body)
                val out = mapOf("result" to "answer", "status" to answer.status, "body" to body)
                if (AnswerPolicy.mayAnswer(out, emptyList())) out else null
            }
        }
    }

    private fun tokenIn(answer: HttpAnswer.Http): String? {
        val body = answer.body as? Map<*, *> ?: return null
        val t = body["riderToken"] as? String
        return if (answer.status == 200 && body.size == 1 && t != null && TOKEN.matches(t)) t else null
    }

    companion object {
        /** The rider-bound messages (routing.json, `to` rider): nothing else goes to the page. */
        val RIDER_TYPES = setOf("welcome", "host_status", "rider_state", "ended")

        /** Close codes after which the token is no use (backend live_wire_policy.py). */
        val FINAL = setOf(4401, 4403, 4409)

        const val MAX_FRAME_CHARS = 64 * 1024
        const val MAX_QUEUED = 64
        private const val MAX_ERROR_CHARS = 64
        private const val NICKNAME_MAX = 24
        private val SESSION = Regex("^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$")
        private val TOKEN = Regex("^cbp_rdr_[A-Za-z0-9_-]{43}$")

        /** `hello`, as the live contract has it (schema/live/v1, hello). Built here: the page never holds the token. */
        fun hello(token: String): String = CanonicalJson.write(mapOf("v" to 1, "type" to "hello", "token" to token))

        /** A frame the rider may see: version 1, one of [RIDER_TYPES], and a welcome only as a rider. */
        fun riderBound(frame: String): Boolean {
            val m = Json.tryParse(frame).getOrNull() as? Map<*, *> ?: return false
            val type = m["type"] as? String ?: return false
            if (m["v"] != 1.0 || type !in RIDER_TYPES) return false
            return type != "welcome" || m["role"] == "rider"
        }

        private fun nicknameFits(n: String): Boolean = n.isNotBlank() && n == n.trim() && n.codePointCount(0, n.length) <= NICKNAME_MAX

        /** Only `{error: <word>}` is passed on; any other body is the page's "unexpected". */
        private fun errorWord(body: Any?): Map<String, Any?>? {
            val m = body as? Map<*, *> ?: return null
            val e = m["error"] as? String ?: return null
            return if (m.size == 1 && e.length <= MAX_ERROR_CHARS && Regex("^[a-z_]+$").matches(e)) mapOf("error" to e) else null
        }
    }
}
