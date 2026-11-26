package org.classbeat.player.policy

import org.classbeat.player.policy.ExternalDisplayPolicy.Shown
import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalDisplayPolicyTest {
    private val room = "/room.html"
    private val idle = "/display.html"
    private val idleRider = "/display-rider.html"
    private val paths = listOf(null, "/index.html", "/instructor.html", room, "/rider.html", idle, idleRider)

    private fun shown(mode: Mode?, path: String? = room, display: Boolean = true, fg: Boolean = true) =
        ExternalDisplayPolicy.shown(mode, path, display, fg)

    @Test
    fun `connect during a class or on the class list shows the idle stage (issue 871)`() {
        assertEquals(Shown.NONE, shown(Mode.INSTRUCTOR, display = false))
        assertEquals(Shown.IDLE, shown(Mode.INSTRUCTOR, display = true))
        assertEquals(Shown.IDLE, shown(Mode.INSTRUCTOR, "/instructor.html"))
        assertEquals(Shown.IDLE, shown(Mode.INSTRUCTOR, "/index.html"))
    }

    @Test
    fun `disconnect mid-class stops the presentation and reconnect shows the idle stage again`() {
        val timeline = listOf(true, false, true)
        assertEquals(listOf(Shown.IDLE, Shown.NONE, Shown.IDLE), timeline.map { shown(Mode.INSTRUCTOR, display = it) })
    }

    @Test
    fun `rider mode shows the rider's idle stage and between modes the instructor's`() {
        for (mode in listOf(Mode.RIDER, null)) for (path in paths) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            val idleStage = if (mode == Mode.RIDER) Shown.IDLE_RIDER else Shown.IDLE
            assertEquals("$mode $path $d $f", if (d && f) idleStage else Shown.NONE, shown(mode, path, d, f))
        }
    }

    @Test
    fun `instructor mode, every input, against a written table`() {
        for (path in paths) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            val want = if (!d || !f) Shown.NONE else Shown.IDLE
            assertEquals("$path $d $f", want, shown(Mode.INSTRUCTOR, path, d, f))
        }
    }

    @Test
    fun `the background and no display never present, in any mode`() {
        for (mode in listOf(Mode.RIDER, Mode.INSTRUCTOR, null)) for (path in paths) {
            assertEquals(Shown.NONE, shown(mode, path, display = true, fg = false))
            assertEquals(Shown.NONE, shown(mode, path, display = false, fg = true))
        }
    }

    @Test
    fun `each shown state maps to its own page, none to no page, and none to the room screen`() {
        assertEquals(null, Shown.NONE.page)
        assertEquals(idle, Shown.IDLE.page)
        assertEquals(idleRider, Shown.IDLE_RIDER.page)
        assertEquals(Shown.entries.size, Shown.entries.map { it.page }.toSet().size)
        for (s in Shown.entries) assertEquals(false, s.page == room)
    }

    @Test
    fun `the idle pages belong to no mode`() {
        for (mode in Mode.entries) assertEquals(false, ExternalDisplayPolicy.IDLE_PAGE in ModePolicy.pages(mode))
        for (mode in Mode.entries) assertEquals(false, ExternalDisplayPolicy.IDLE_RIDER_PAGE in ModePolicy.pages(mode))
    }

    @Test
    fun `the presentation's web view loads the bundle, and in its main frame an idle page only`() {
        val base = "https://localhost"
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/display.html", mainFrame = true))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/display.html?x=1#y", mainFrame = true))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/display-rider.html", mainFrame = true))
        // The room screen needs the bridge, which this view has not (issue #871).
        for (other in listOf(
            "/room.html", "/room.html?id=0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0", "/instructor.html", "/instructor.html#class-missing",
            "/rider.html", "/index.html", "/", "/display.html/x", "/room.htm", "/display-rider.html/x", "/display-rider.htm",
        )) {
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
            "https://example.com/display.html", "https://localhost/%2e%2e/display.html",
        )) for (main in listOf(false, true)) {
            assertEquals("$url $main", false, ExternalDisplayPolicy.mayLoad(url, main))
        }
    }
}
