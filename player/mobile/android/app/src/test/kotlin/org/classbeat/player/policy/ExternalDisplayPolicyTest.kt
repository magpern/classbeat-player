package org.classbeat.player.policy

import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalDisplayPolicyTest {
    private val room = "/room.html"

    private fun present(mode: Mode?, path: String? = room, display: Boolean = true, fg: Boolean = true) =
        ExternalDisplayPolicy.present(mode, path, display, fg)

    @Test
    fun `connect during a class in instructor mode presents the room screen`() {
        assertEquals(false, present(Mode.INSTRUCTOR, display = false))
        assertEquals(true, present(Mode.INSTRUCTOR, display = true))
    }

    @Test
    fun `disconnect mid-class stops the presentation and reconnect presents again`() {
        val timeline = listOf(true, false, true)
        assertEquals(listOf(true, false, true), timeline.map { present(Mode.INSTRUCTOR, display = it) })
    }

    @Test
    fun `rider mode never presents, whatever else holds`() {
        for (path in listOf(null, "/index.html", "/instructor.html", room, "/rider.html")) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            assertEquals(false, present(Mode.RIDER, path, d, f))
        }
    }

    @Test
    fun `between modes nothing is presented`() {
        for (path in listOf(null, room)) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            assertEquals(false, present(null, path, d, f))
        }
    }

    @Test
    fun `instructor mode presents only on the class page, with a display, in the foreground`() {
        for (path in listOf(null, "/index.html", "/instructor.html", room, "/rider.html")) for (d in listOf(false, true)) for (f in listOf(false, true)) {
            assertEquals(path == room && d && f, present(Mode.INSTRUCTOR, path, d, f))
        }
    }

    @Test
    fun `the presented page is the instructor's room page`() {
        assertEquals(true, ExternalDisplayPolicy.ROOM_PAGE in ModePolicy.pages(Mode.INSTRUCTOR))
        assertEquals(false, ExternalDisplayPolicy.ROOM_PAGE in ModePolicy.pages(Mode.RIDER))
    }

    @Test
    fun `the presentation's web view loads the bundle, and in its main frame the room page only`() {
        val base = "https://localhost"
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/room.html", mainFrame = true))
        assertEquals(true, ExternalDisplayPolicy.mayLoad("$base/room.html?x=1#y", mainFrame = true))
        for (other in listOf("/instructor.html", "/rider.html", "/index.html", "/")) {
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
