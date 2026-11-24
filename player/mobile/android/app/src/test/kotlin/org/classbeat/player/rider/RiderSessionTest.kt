package org.classbeat.player.rider

import java.io.File
import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.backend.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rider's session against a fake transport (issue #633). Nothing here touches a network. */
class RiderSessionTest {
    private val token = "cbp_rdr_" + "Ab3_-".repeat(8) + "xyz"
    private val root = File("../../../..")
    private val transport = FakeRiderTransport()
    private val session = RiderSession(transport)

    /** Everything the page was given, written out: an answer or an event, or "refused". */
    private val toPage = mutableListOf<String>()
    private val reply: RiderReply = { toPage += if (it == null) "refused" else CanonicalJson.write(it) }

    private fun example(dir: String, name: String) = File(root, "schema/live/v1/examples/$dir/valid/$name").readText()

    private fun joined() {
        session.join("KXPD-RMTB", "Sam", reply)
        transport.answerJoin(HttpAnswer.Http(200, mapOf("riderToken" to token), null))
        assertTrue(session.joined)
    }

    private fun opened(): FakeRiderTransport.Link {
        session.open(reply)
        val link = transport.links.last()
        link.listener.opened()
        return link
    }

    /** No answer or event the page got holds the token, or any part of it long enough to matter. */
    private fun assertTokenNeverReachedThePage() {
        for (sent in toPage) for (i in 0..token.length - 12) assertFalse(sent, sent.contains(token.substring(i, i + 12)))
    }

    @Test
    fun `the token from the join stays native, and hello carries it the way the contract has it`() {
        joined()
        val link = opened()
        val hello = link.sent.single()
        val shape = Json.parse(example("hello", "rdr-token.json")) as Map<*, *>
        val sent = Json.parse(hello) as Map<*, *>
        assertEquals(shape.keys, sent.keys)
        assertEquals(shape - "token", sent - "token")
        assertEquals(token, sent["token"])
        assertEquals(listOf("""{"result":"joined"}""", """{"result":"opening"}"""), toPage)
        assertTokenNeverReachedThePage()
    }

    @Test
    fun `the token never reaches the page, whatever comes in`() {
        joined()
        val link = opened()
        // A frame that echoes the token (no real server sends one) is dropped, not passed on.
        link.listener.text("""{"v":1,"type":"host_status","connected":true,"note":"$token"}""")
        link.listener.text(example("welcome-rider", "host-in.json"))
        repeat(4) { session.receive(reply) }
        assertTokenNeverReachedThePage()
        assertTrue(toPage.any { it.contains("welcome") })
    }

    @Test
    fun `a join answer other than a good token gives the page only the status and the error word`() {
        val answers = listOf(
            HttpAnswer.Unreachable to """{"result":"unreachable"}""",
            HttpAnswer.Http(404, mapOf("error" to "cannot_join"), null) to """{"body":{"error":"cannot_join"},"result":"answer","status":404}""",
            HttpAnswer.Http(200, mapOf("riderToken" to "cbp_rdr_short"), null) to """{"body":null,"result":"answer","status":200}""",
            HttpAnswer.Http(200, mapOf("riderToken" to token, "x" to 1.0), null) to """{"body":null,"result":"answer","status":200}""",
            HttpAnswer.Http(500, mapOf("error" to "x", "trace" to "y"), null) to """{"body":null,"result":"answer","status":500}""",
        )
        for ((answer, expected) in answers) {
            toPage.clear()
            session.join("KXPD-RMTB", "Sam", reply)
            transport.answerJoin(answer)
            assertEquals(listOf(expected), toPage)
            assertFalse(session.joined)
        }
    }

    @Test
    fun `a join with a code or nickname of the wrong form, or while joined, is refused and nothing is sent`() {
        for ((code, nick) in listOf("kxpd-rmtb" to "Sam", "KXPDRMTB" to "Sam", "KXPD-RMTA" to "Sam", "KXPD-RMTB" to "", "KXPD-RMTB" to " Sam", "KXPD-RMTB" to "x".repeat(25))) {
            session.join(code, nick, reply)
        }
        assertEquals(0, transport.joins)
        joined()
        toPage.clear()
        session.join("KXPD-RMTB", "Sam", reply)
        assertEquals(listOf("refused"), toPage)
    }

    @Test
    fun `no host event or other role's message reaches the page in rider mode`() {
        joined()
        val link = opened()
        val routing = Json.parse(File(root, "schema/live/v1/routing.json").readText()) as Map<*, *>
        var riderBound = 0
        for (m in routing["messages"] as List<*>) {
            m as Map<*, *>
            val dir = (m["schema"] as String).removeSuffix(".schema.json")
            val toRider = "rider" in (m["to"] as List<*>)
            for (file in File(root, "schema/live/v1/examples/$dir/valid").listFiles()!!.sortedBy { it.name }) {
                val text = file.readText()
                assertEquals("$dir/${file.name}", toRider, RiderSession.riderBound(text))
                if (!toRider) link.listener.text(text)
            }
            if (toRider) riderBound++
        }
        assertEquals(RiderSession.RIDER_TYPES.size, riderBound)
        toPage.clear()
        session.receive(reply)
        // Only "opened" was waiting: every host, controller and server-bound message was dropped.
        assertEquals(listOf("""{"kind":"opened"}"""), toPage)
    }

    @Test
    fun `the native rider types are exactly the ones routing json sends to a rider`() {
        val routing = Json.parse(File(root, "schema/live/v1/routing.json").readText()) as Map<*, *>
        val toRider = (routing["messages"] as List<*>).map { it as Map<*, *> }.filter { "rider" in (it["to"] as List<*>) }.map { it["type"] }.toSet()
        assertEquals(toRider, RiderSession.RIDER_TYPES)
    }

    @Test
    fun `a frame of another version, a welcome as host, or one too long is dropped`() {
        joined()
        val link = opened()
        link.listener.text("""{"v":2,"type":"host_status","connected":true}""")
        link.listener.text("""{"v":1,"type":"welcome","role":"host"}""")
        link.listener.text("""{"v":1,"type":"host_status","connected":true,"pad":"${"x".repeat(RiderSession.MAX_FRAME_CHARS)}"}""")
        link.listener.text("not json")
        toPage.clear()
        repeat(2) { session.receive(reply) }
        assertEquals(listOf("""{"kind":"opened"}"""), toPage.take(1))
        assertEquals(1, toPage.size)
    }

    @Test
    fun `a full queue drops passing events, never a close or the class's ended`() {
        joined()
        opened().listener.closed(1006)
        val link = opened()
        val status = example("host-status", "connected.json")
        repeat(RiderSession.MAX_QUEUED * 2) { link.listener.text(status) }
        link.listener.text(example("ended", "host-ended.json"))
        while (true) {
            val before = toPage.size
            session.receive(reply)
            if (toPage.size == before || toPage.last() == "refused") break
        }
        // The join's and the opens' own answers have no "kind"; only the events do.
        val events = toPage.filter { it != "refused" }.map { Json.tryParse(it).getOrNull() as Map<*, *> }.filter { "kind" in it }
        assertEquals(RiderSession.MAX_QUEUED, events.size)
        assertEquals(mapOf("kind" to "closed", "code" to 1006.0), events.first { it["kind"] == "closed" })
        val last = Json.tryParse(events.last()["text"] as String).getOrNull() as Map<*, *>
        assertEquals("ended", last["type"])
    }

    @Test
    fun `leaving closes the link, drops the token and refuses what comes later`() {
        joined()
        val link = opened()
        session.receive(reply)
        session.receive(reply) // waiting
        toPage.clear()
        session.leave(reply)
        assertEquals(listOf("refused", """{"result":"left"}"""), toPage)
        assertFalse(session.joined)
        assertTrue(link.closed)
        // A late frame from the old link goes nowhere; nothing can be received or opened.
        link.listener.text(example("host-status", "connected.json"))
        toPage.clear()
        session.receive(reply)
        session.open(reply)
        assertEquals(listOf("refused", "refused"), toPage)
    }

    @Test
    fun `a drop (mode switch or exit) during a join keeps no token from the late answer`() {
        session.join("KXPD-RMTB", "Sam", reply)
        session.drop()
        transport.answerJoin(HttpAnswer.Http(200, mapOf("riderToken" to token), null))
        assertFalse(session.joined)
        assertEquals(listOf("refused"), toPage)
    }

    @Test
    fun `the class ended, or the token refused, drops the token, and a lost link keeps it to reconnect`() {
        joined()
        var link = opened()
        link.listener.closed(RiderTransport.CLOSE_LOST)
        assertTrue(session.joined)
        link = opened()
        link.listener.closed(4401)
        assertFalse(session.joined)
        // The page reads what was waiting: both links' events, the last its final close.
        repeat(4) { session.receive(reply) }
        assertEquals("""{"code":4401,"kind":"closed"}""", toPage.last())

        joined()
        link = opened()
        link.listener.text(example("ended", "dropped.json"))
        assertFalse(session.joined)
        assertTrue(link.closed)
        toPage.clear()
        repeat(3) { session.receive(reply) }
        assertEquals("""{"kind":"opened"}""", toPage[0])
        assertTrue(toPage[1].contains("dropped"))
        assertEquals("refused", toPage[2])
        assertTokenNeverReachedThePage()
    }

    @Test
    fun `back while joined becomes an event for the page, and nothing when not joined`() {
        session.backPressed()
        joined()
        var changes = 0
        session.changed = { changes++ }
        session.backPressed()
        session.receive(reply)
        assertEquals("""{"kind":"back"}""", toPage.last())
        session.drop()
        assertEquals(1, changes)
    }

    @Test
    fun `the stand-in transport is offline for every join and every link`() {
        val posted = mutableListOf<Runnable>()
        val offline = RiderSession(OfflineRiderTransport { posted += it })
        offline.join("KXPD-RMTB", "Sam", reply)
        assertTrue(toPage.isEmpty())
        posted.removeAt(0).run()
        assertEquals(listOf("""{"result":"unreachable"}"""), toPage)
        assertFalse(offline.joined)
        var closedWith: Int? = null
        val link = OfflineRiderTransport { it.run() }.open(object : RiderLink.Listener {
            override fun opened() = Unit
            override fun text(frame: String) = Unit
            override fun closed(code: Int) {
                closedWith = code
            }
        })
        link.send("x")
        assertEquals(RiderTransport.CLOSE_LOST, closedWith)
    }

    @Test
    fun `the rider code keeps nothing on disk, in preferences or anywhere else`() {
        // The token lives only in RiderSession's memory: no rider source names a storage API.
        val sources = File("src/main/kotlin/org/classbeat/player/rider").listFiles()!!.toList() +
            File("src/main/kotlin/org/classbeat/player/mode/RiderBridge.kt")
        assertTrue(sources.size >= 3)
        val storage = Regex("SharedPreferences|getSharedPreferences|java\\.io|java\\.nio|File\\(|openFileOutput|DataStore|Room|SQLite|KeyStore|Keystore|Bundle|putString|savedInstanceState|Log\\.|println")
        for (f in sources) assertNull(f.path, storage.find(f.readText())?.value)
    }
}
