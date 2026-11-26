package org.classbeat.player.policy

import org.classbeat.player.policy.IntentPolicy.Arg
import org.classbeat.player.policy.IntentPolicy.Refusal
import org.classbeat.player.policy.IntentPolicy.Spec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentPolicyTest {
    private val other = mapOf(Mode.RIDER to Mode.INSTRUCTOR, Mode.INSTRUCTOR to Mode.RIDER)

    @Test
    fun `every intent is listed here by hand, with its mode`() {
        // A new intent fails this test until it is added here, with a test of its arguments below.
        val expected = mapOf(
            "instructorWay" to Mode.RIDER,
            "askInstructorMode" to Mode.RIDER,
            "join" to Mode.RIDER,
            "open" to Mode.RIDER,
            "receive" to Mode.RIDER,
            "leave" to Mode.RIDER,
            "askRiderMode" to Mode.INSTRUCTOR,
            "listClasses" to Mode.INSTRUCTOR,
            "syncNow" to Mode.INSTRUCTOR,
            "getClass" to Mode.INSTRUCTOR,
            "unpair" to Mode.INSTRUCTOR,
            "pairAgain" to Mode.INSTRUCTOR,
            "followAccess" to Mode.INSTRUCTOR,
            "openFollowSetting" to Mode.INSTRUCTOR,
            "follow" to Mode.INSTRUCTOR,
            "unfollow" to Mode.INSTRUCTOR,
            "reading" to Mode.INSTRUCTOR,
            "sendPlay" to Mode.INSTRUCTOR,
            "sendPause" to Mode.INSTRUCTOR,
            "sendNext" to Mode.INSTRUCTOR,
        )
        assertEquals(expected, IntentPolicy.INTENTS.mapValues { it.value.mode })
    }

    @Test
    fun `rider mode has no instructor intent and instructor mode has no rider intent`() {
        val rider = IntentPolicy.of(Mode.RIDER)
        val instructor = IntentPolicy.of(Mode.INSTRUCTOR)
        assertEquals(setOf("instructorWay", "askInstructorMode", "join", "open", "receive", "leave"), rider)
        assertEquals(
            setOf("askRiderMode", "listClasses", "syncNow", "getClass", "unpair", "pairAgain", "followAccess", "openFollowSetting", "follow", "unfollow", "reading", "sendPlay", "sendPause", "sendNext"),
            instructor,
        )
        assertTrue(rider.intersect(instructor).isEmpty())
        assertEquals(IntentPolicy.INTENTS.keys, rider + instructor)
    }

    @Test
    fun `each intent runs only from its own mode's plugin while the app is in that mode`() {
        for ((name, spec) in IntentPolicy.INTENTS) {
            val mode = spec.mode
            val args = good(spec)
            assertNull(name, IntentPolicy.check(mode, mode, name, args))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(mode, other.getValue(mode), name, args))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(other.getValue(mode), mode, name, args))
            assertEquals(name, Refusal.SWITCHING, IntentPolicy.check(null, mode, name, args))
        }
    }

    @Test
    fun `each intent rejects an unexpected argument`() {
        val extras = listOf("mode" to "instructor", "unlock" to true, "x" to null, "" to 1, "__proto__" to "{}")
        for ((name, spec) in IntentPolicy.INTENTS) {
            for (extra in extras) {
                assertEquals("$name $extra", Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(spec.mode, spec.mode, name, good(spec) + extra))
            }
        }
    }

    @Test
    fun `instructorWay rejects an unexpected argument`() = rejectsExtra("instructorWay")

    @Test
    fun `askInstructorMode rejects an unexpected argument`() = rejectsExtra("askInstructorMode")

    @Test
    fun `askRiderMode rejects an unexpected argument`() = rejectsExtra("askRiderMode")

    @Test
    fun `listClasses rejects an unexpected argument`() = rejectsExtra("listClasses")

    @Test
    fun `syncNow rejects an unexpected argument`() = rejectsExtra("syncNow")

    @Test
    fun `unpair rejects an unexpected argument`() = rejectsExtra("unpair")

    @Test
    fun `pairAgain rejects an unexpected argument`() = rejectsExtra("pairAgain")

    @Test
    fun `open rejects an unexpected argument`() = rejectsExtra("open")

    @Test
    fun `receive rejects an unexpected argument`() = rejectsExtra("receive")

    @Test
    fun `leave rejects an unexpected argument`() = rejectsExtra("leave")

    @Test
    fun `join takes the class code and a nickname, both strings, and nothing else`() {
        fun check(args: Map<String, Any?>) = IntentPolicy.check(Mode.RIDER, Mode.RIDER, "join", args)
        val good = mapOf<String, Any?>("session" to "KXPD-RMTB", "nickname" to "Sam")
        assertNull(check(good))
        assertEquals(Refusal.MISSING_ARGUMENT, check(good - "session"))
        assertEquals(Refusal.MISSING_ARGUMENT, check(good - "nickname"))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("session" to 1)))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("nickname" to null)))
        // The rider's numbers never go to native code, and the page names no address or token.
        for (extra in listOf("ftp", "hrmax", "token", "riderToken", "url", "path")) {
            assertEquals(extra, Refusal.UNEXPECTED_ARGUMENT, check(good + (extra to "x")))
        }
    }

    @Test
    fun `the follow intents take no argument, so the page names no app, session or package`() {
        for (name in listOf("followAccess", "openFollowSetting", "follow", "unfollow", "reading")) {
            rejectsExtra(name)
            for (extra in listOf("package", "app", "session", "token")) {
                assertEquals("$name $extra", Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(Mode.INSTRUCTOR, Mode.INSTRUCTOR, name, mapOf(extra to "x")))
            }
            // Notification access is asked for only in instructor mode: never from rider mode's plugin or page.
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(Mode.RIDER, Mode.RIDER, name, emptyMap()))
        }
    }

    @Test
    fun `the only music commands are play, pause and next, and none takes an argument`() {
        // #857: the page sends one of three fixed intents and names no command, app, session or position.
        val commands = setOf("sendPlay", "sendPause", "sendNext")
        for (name in commands) {
            assertNull(name, IntentPolicy.check(Mode.INSTRUCTOR, Mode.INSTRUCTOR, name, emptyMap()))
            rejectsExtra(name)
            for (extra in listOf("command", "action", "position", "package", "app", "session", "volume")) {
                assertEquals("$name $extra", Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(Mode.INSTRUCTOR, Mode.INSTRUCTOR, name, mapOf(extra to "x")))
            }
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(Mode.RIDER, Mode.RIDER, name, emptyMap()))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(Mode.INSTRUCTOR, Mode.RIDER, name, emptyMap()))
            assertEquals(name, Refusal.OTHER_MODE, IntentPolicy.check(Mode.RIDER, Mode.INSTRUCTOR, name, emptyMap()))
            assertEquals(name, Refusal.SWITCHING, IntentPolicy.check(null, Mode.INSTRUCTOR, name, emptyMap()))
        }
        for (name in listOf("play", "pause", "next", "sendStop", "sendSeek", "send", "stop", "seek", "seekTo", "previous", "skipToPrevious", "setVolume", "rewind", "fastForward", "PLAY", "Next", "playPause", "command")) {
            for (mode in Mode.entries) assertEquals(name, Refusal.UNKNOWN, IntentPolicy.check(mode, mode, name, emptyMap()))
        }
    }

    @Test
    fun `getClass takes one id, a string, and nothing else`() {
        fun check(args: Map<String, Any?>) = IntentPolicy.check(Mode.INSTRUCTOR, Mode.INSTRUCTOR, "getClass", args)
        assertNull(check(mapOf("id" to "00000000-0000-4000-8000-000000000001")))
        assertEquals(Refusal.MISSING_ARGUMENT, check(emptyMap()))
        assertEquals(Refusal.WRONG_TYPE, check(mapOf("id" to 1)))
        assertEquals(Refusal.WRONG_TYPE, check(mapOf("id" to null)))
        // The page names no address, path or token: there is no argument to carry one.
        for (extra in listOf("url", "path", "origin", "token", "headers")) {
            assertEquals(extra, Refusal.UNEXPECTED_ARGUMENT, check(mapOf("id" to "x", extra to "x")))
        }
    }

    /** Arguments of the right names and types for [spec]. */
    private fun good(spec: Spec): Map<String, Any?> = spec.args.mapValues { (_, type) ->
        when (type) {
            Arg.STRING -> "x"
            Arg.BOOLEAN -> true
            Arg.NUMBER -> 1
        }
    }

    private fun rejectsExtra(name: String) {
        val mode = IntentPolicy.INTENTS.getValue(name).mode
        assertEquals(Refusal.UNEXPECTED_ARGUMENT, IntentPolicy.check(mode, mode, name, good(IntentPolicy.INTENTS.getValue(name)) + ("mode" to "instructor")))
    }

    @Test
    fun `an unknown name is refused in either mode`() {
        for (name in listOf("", "setMode", "unlock", "askinstructormode", "askRiderMode ")) {
            for (mode in Mode.entries) assertEquals(Refusal.UNKNOWN, IntentPolicy.check(mode, mode, name, emptyMap()))
        }
    }

    @Test
    fun `typed arguments are checked by name and type`() {
        val intents = mapOf("join" to Spec(Mode.RIDER, mapOf("code" to Arg.STRING, "again" to Arg.BOOLEAN, "n" to Arg.NUMBER)))
        val good = mapOf<String, Any?>("code" to "AB12", "again" to false, "n" to 3)
        fun check(args: Map<String, Any?>) = IntentPolicy.check(Mode.RIDER, Mode.RIDER, "join", args, intents)
        assertNull(check(good))
        assertEquals(Refusal.MISSING_ARGUMENT, check(good - "code"))
        assertEquals(Refusal.UNEXPECTED_ARGUMENT, check(good + ("extra" to 1)))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("code" to 12)))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("again" to "true")))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("n" to "3")))
        assertEquals(Refusal.WRONG_TYPE, check(good + ("code" to null)))
        assertEquals(setOf("join"), IntentPolicy.of(Mode.RIDER, intents))
    }
}
