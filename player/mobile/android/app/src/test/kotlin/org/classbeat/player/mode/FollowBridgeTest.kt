package org.classbeat.player.mode

import org.classbeat.player.follow.Follower
import org.classbeat.player.follow.ListenerAccess
import org.classbeat.player.follow.MusicSource
import org.classbeat.player.follow.SourceReading
import org.classbeat.player.follow.SourceStatus
import org.classbeat.player.follow.TransportCommand
import org.classbeat.player.policy.Mode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The follow intents' own mode check and answer guard (issue #632, #668), on a real follower with fakes. */
class FollowBridgeTest {
    /** Everything the follower did to the source and the listener. */
    private val log = mutableListOf<String>()

    private val access = object : ListenerAccess {
        override fun granted() = true

        override fun enable(on: Boolean) {
            log += "enable $on"
        }

        override fun openSetting(): Boolean {
            log += "openSetting"
            return true
        }
    }

    private val source = object : MusicSource {
        override fun start() {
            log += "start"
        }

        override fun stop() {
            log += "stop"
        }

        override fun status() = SourceStatus.READING

        override fun latest() = SourceReading("track:1", "Song A", "Band A", 180_000, true, 10_000, 49_200)

        override fun command(command: TransportCommand): Boolean {
            log += "command $command"
            return true
        }
    }

    private val follower = Follower(source, access) { 50_000L }.also { log.clear() }

    private var mode: Mode? = Mode.INSTRUCTOR
    private var secrets = listOf<String>()
    private val bridge = FollowBridge(follower, { secrets }) { mode }

    /** Each intent once, in order, with what it sent the page. */
    private fun callAll(): List<String?> {
        val sent = mutableListOf<String?>()
        bridge.followAccess { sent += it }
        bridge.openFollowSetting { sent += it }
        bridge.follow { sent += it }
        bridge.reading { sent += it }
        bridge.unfollow { sent += it }
        return sent
    }

    /** Play, pause and next once each (#857), with what each sent the page. */
    private fun commandAll(): List<String?> {
        val sent = mutableListOf<String?>()
        bridge.command(TransportCommand.PLAY) { sent += it }
        bridge.command(TransportCommand.PAUSE) { sent += it }
        bridge.command(TransportCommand.NEXT) { sent += it }
        return sent
    }

    @Test
    fun `outside instructor mode every follow intent is refused and the follower is never asked`() {
        for (other in listOf(Mode.RIDER, null)) {
            mode = other
            log.clear()
            assertEquals("$other", List(5) { null }, callAll())
            assertEquals("$other", emptyList<String>(), log)
        }
    }

    @Test
    fun `in instructor mode each intent is answered`() {
        val sent = callAll()
        sent.forEach { assertNotNull(it) }
        assertEquals("""{"state":"following"}""", sent[2])
        assertEquals(listOf("enable true", "openSetting", "enable true", "start", "stop"), log)
    }

    @Test
    fun `an answer holding a secret is refused`() {
        bridge.follow { }
        secrets = listOf("track:1")
        var sent: String? = "unset"
        bridge.reading { sent = it }
        assertNull(sent)
    }

    @Test
    fun `outside instructor mode play, pause and next are refused and nothing reaches the music app`() {
        bridge.follow { }
        for (other in listOf(Mode.RIDER, null)) {
            mode = other
            log.clear()
            assertEquals("$other", List(3) { null }, commandAll())
            assertEquals("$other", emptyList<String>(), log)
        }
    }

    @Test
    fun `while following, play, pause and next each send their own command once`() {
        bridge.follow { }
        log.clear()
        assertEquals(List(3) { """{"state":"sent"}""" }, commandAll())
        assertEquals(listOf("command PLAY", "command PAUSE", "command NEXT"), log)
    }

    @Test
    fun `before following a command answers stopped and sends nothing`() {
        assertEquals(List(3) { """{"state":"stopped"}""" }, commandAll())
        assertEquals(emptyList<String>(), log)
    }
}
