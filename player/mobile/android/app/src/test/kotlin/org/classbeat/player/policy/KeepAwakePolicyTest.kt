package org.classbeat.player.policy

import org.junit.Assert.assertEquals
import org.junit.Test

class KeepAwakePolicyTest {
    private val bools = listOf(false, true)
    private val paths = listOf(null, "/index.html", "/instructor.html", "/room.html", "/rider.html")

    @Test
    fun `instructor mode keeps the screen on on the class page only, in the foreground`() {
        for (path in paths) for (joined in bools) {
            assertEquals(path == "/room.html", KeepAwakePolicy.keepOn(Mode.INSTRUCTOR, path, joined, foreground = true))
            assertEquals(false, KeepAwakePolicy.keepOn(Mode.INSTRUCTOR, path, joined, foreground = false))
        }
    }

    @Test
    fun `rider mode keeps the screen on while joined, in the foreground, whatever page`() {
        for (path in paths) {
            assertEquals(true, KeepAwakePolicy.keepOn(Mode.RIDER, path, riderJoined = true, foreground = true))
            assertEquals(false, KeepAwakePolicy.keepOn(Mode.RIDER, path, riderJoined = false, foreground = true))
            assertEquals(false, KeepAwakePolicy.keepOn(Mode.RIDER, path, riderJoined = true, foreground = false))
            assertEquals(false, KeepAwakePolicy.keepOn(Mode.RIDER, path, riderJoined = false, foreground = false))
        }
    }

    @Test
    fun `between modes the screen is never kept on`() {
        for (path in paths) for (joined in bools) for (fg in bools) {
            assertEquals(false, KeepAwakePolicy.keepOn(null, path, joined, fg))
        }
    }

    @Test
    fun `the class page is the instructor mode's class page`() {
        assertEquals(true, KeepAwakePolicy.CLASS_PAGE in ModePolicy.pages(Mode.INSTRUCTOR))
        assertEquals(false, KeepAwakePolicy.CLASS_PAGE == ModePolicy.startPage(Mode.INSTRUCTOR))
    }

    @Test
    fun `instructor class page does not count in rider mode`() {
        assertEquals(false, KeepAwakePolicy.keepOn(Mode.RIDER, "/room.html", riderJoined = false, foreground = true))
    }
}
