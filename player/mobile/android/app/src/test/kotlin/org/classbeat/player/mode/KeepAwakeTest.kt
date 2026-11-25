package org.classbeat.player.mode

import org.classbeat.player.policy.KeepAwakePolicy
import org.classbeat.player.policy.Mode
import org.junit.Assert.assertEquals
import org.junit.Test

/** The wiring of the window flag (issue #749): it is set when the policy says on and cleared when it says off. */
class KeepAwakeTest {
    /** A fake window: the flag as the last call left it, and every call made. */
    private class FakeFlag : ScreenFlag {
        var set = false
        val calls = mutableListOf<Boolean>()

        override fun keepOn(on: Boolean) {
            set = on
            calls += on
        }
    }

    private val bools = listOf(false, true)
    private val modes = listOf(null, Mode.INSTRUCTOR, Mode.RIDER)
    private val paths = listOf(null, "/index.html", KeepAwakePolicy.CLASS_PAGE, "/rider.html")

    @Test
    fun `every input combination sets or clears the flag as the policy says`() {
        for (mode in modes) for (path in paths) for (joined in bools) for (fg in bools) {
            val expected = KeepAwakePolicy.keepOn(mode, path, joined, fg)
            // Start from the opposite state, so a call that does nothing cannot pass.
            val flag = FakeFlag().also { it.set = !expected }
            KeepAwake(flag).sync(mode, path, joined, fg)
            assertEquals("$mode $path joined=$joined fg=$fg", expected, flag.set)
            assertEquals(1, flag.calls.size)
        }
    }

    @Test
    fun `each input change moves the flag`() {
        val flag = FakeFlag()
        val awake = KeepAwake(flag)
        val room = KeepAwakePolicy.CLASS_PAGE
        // Instructor: the class page, in the foreground.
        awake.sync(Mode.INSTRUCTOR, "/instructor.html", false, true)
        assertEquals(false, flag.set)
        awake.sync(Mode.INSTRUCTOR, room, false, true)
        assertEquals(true, flag.set)
        awake.sync(Mode.INSTRUCTOR, room, false, false)
        assertEquals(false, flag.set)
        awake.sync(Mode.INSTRUCTOR, room, false, true)
        assertEquals(true, flag.set)
        awake.sync(Mode.INSTRUCTOR, "/instructor.html", false, true)
        assertEquals(false, flag.set)
        // Rider: joined and in the foreground.
        awake.sync(Mode.RIDER, "/rider.html", false, true)
        assertEquals(false, flag.set)
        awake.sync(Mode.RIDER, "/rider.html", true, true)
        assertEquals(true, flag.set)
        awake.sync(Mode.RIDER, "/rider.html", false, true)
        assertEquals(false, flag.set)
        awake.sync(Mode.RIDER, "/rider.html", true, true)
        assertEquals(true, flag.set)
        awake.sync(null, null, true, true)
        assertEquals(false, flag.set)
    }

    @Test
    fun `release clears the flag whatever the policy would say`() {
        val flag = FakeFlag()
        val awake = KeepAwake(flag)
        awake.sync(Mode.RIDER, "/rider.html", true, true)
        assertEquals(true, flag.set)
        awake.release()
        assertEquals(false, flag.set)
    }
}
