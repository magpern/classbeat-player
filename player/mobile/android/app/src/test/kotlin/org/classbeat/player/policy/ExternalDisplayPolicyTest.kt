package org.classbeat.player.policy

import org.classbeat.player.policy.ExternalDisplayPolicy.Shown
import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalDisplayPolicyTest {
    private val room = "/room.html"
    private val idle = "/display.html"
    private val paths = listOf(null, "/index.html", "/instructor.html", room, "/rider.html", idle)

    private fun shown(mode: Mode?, path: String? = room, display: Boolean = true, fg: Boolean = true) =
        ExternalDisplayPolicy.shown(mode, path, display, fg)

    @Test
    fun `connect during a class shows the room screen, and on the class list the idle stage`() {
        assertEquals(Shown.NONE, shown(Mode.INSTRUCTOR, display = false))
        assertEquals(Shown.ROOM, shown(Mode.INSTRUCTOR, display = true))
        assertEquals(Shown.IDLE, shown(Mode.INSTRUCTOR, "/instructor.html"))
        assertEquals(Shown.IDLE, shown(Mode.INSTRUCTOR, "/index.html"))
    }

    @Test
    fun `disconnect mid-class stops the presentation and reconnect shows the room screen again`() {
        val timeline = listOf(true, false, true)
        assertEquals(listOf(Shown.ROOM, Shown.NONE, Shown.ROOM), timeline.map { shown(Mode.INSTRUCTOR, display = it) })
    }

    @Test
    fun `rider mode and between modes never present, whatever else holds`() {
        for (mode in listOf(Mode.RIDER, null)) for (path in paths) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            assertEquals(Shown.NONE, shown(mode, path, d, f))
        }
    }

    @Test
    fun `instructor mode, every input, against a written table`() {
        for (path in paths) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            val want = when {
                !d || !f || path == null -> Shown.NONE
                path == room -> Shown.ROOM
                else -> Shown.IDLE
            }
            assertEquals("$path $d $f", want, shown(Mode.INSTRUCTOR, path, d, f))
        }
    }

    @Test
    fun `each shown state maps to its own page, and none to no page`() {
        assertEquals(null, Shown.NONE.page)
        assertEquals(room, Shown.ROOM.page)
        assertEquals(idle, Shown.IDLE.page)
        assertEquals(Shown.entries.size, Shown.entries.map { it.page }.toSet().size)
    }

    @Test
    fun `the room page is the instructor's, and the idle page belongs to no mode`() {
        assertEquals(true, ExternalDisplayPolicy.ROOM_PAGE in ModePolicy.pages(Mode.INSTRUCTOR))
        assertEquals(false, ExternalDisplayPolicy.ROOM_PAGE in ModePolicy.pages(Mode.RIDER))
        for (mode in Mode.entries) assertEquals(false, ExternalDisplayPolicy.IDLE_PAGE in ModePolicy.pages(mode))
    }

    @Test
    fun `the presentation's web view loads the bundle, and in its main frame the room page or the idle page only`() {
        val base = "https://localhost"
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/room.html", mainFrame = true))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/room.html?x=1#y", mainFrame = true))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/display.html", mainFrame = true))
        for (other in listOf("/instructor.html", "/rider.html", "/index.html", "/", "/display.html/x", "/room.htm")) {
            assertEquals(other, false, ExternalDisplayPolicy.mayLoad("$base$other", mainFrame = true))
        }
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/main.js", mainFrame = false))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/fonts/a.woff2", mainFrame = false))
    }

    @Test
    fun `the presentation's web view loads nothing outside the bundle`() {
        for (url in listOf(
            "https://example.com/room.html", "http://localhost/room.html", "https://localhost:8443/room.html",
            "data:text/html,x", "blob:https://localhost/x", "file:///android_asset/public/room.html",
            "https://localhost/_capacitor_file_/x", "https://localhost/%2e%2e/room.html", "https://localhost/room.html%2f..%2fx",
        )) for (main in listOf(false, true)) {
            assertEquals("$url $main", false, ExternalDisplayPolicy.mayLoad(url, main))
        }
    }
}
