package org.classbeat.player.mode

import org.classbeat.player.policy.Mode
import org.classbeat.player.policy.ModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A mode's plugin reaches the bridge only once the last mode's page is gone (issue #630, review of PR #643). */
class PageOpenerTest {
    private val log = mutableListOf<String>()

    /** Which plugin is on the bridge, as the fake bridge sees it. */
    private var exposed: Mode? = null

    private val opener = PageOpener(object : PageSteps {
        override fun expose(mode: Mode?) {
            exposed = mode
            log += "expose $mode"
        }

        override fun load(path: String) { log += "load $path" }

        override fun ready() { log += "ready" }
    })

    private val blank = PageOpener.BLANK

    @Test
    fun `a switch takes every plugin off and loads the blank page first`() {
        exposed = Mode.RIDER
        opener.open(Mode.INSTRUCTOR)
        assertEquals(listOf("expose null", "load $blank"), log)
        assertNull(exposed)
    }

    @Test
    fun `the new mode's plugin goes on only after the blank page has replaced the last page`() {
        opener.open(Mode.INSTRUCTOR)
        // The rider page is still the document: anything it reports changes nothing.
        opener.committed("/rider.html")
        assertNull(exposed)
        opener.committed(blank)
        assertEquals(Mode.INSTRUCTOR, exposed)
        assertEquals(listOf("expose null", "load $blank", "expose INSTRUCTOR", "load /instructor.html"), log)
        opener.committed("/instructor.html")
        assertEquals("ready", log.last())
    }

    @Test
    fun `the same order in the other direction`() {
        opener.open(Mode.RIDER)
        opener.committed("/instructor.html")
        opener.committed("/room.html")
        assertNull(exposed)
        opener.committed(blank)
        opener.committed("/rider.html")
        assertEquals(listOf("expose null", "load $blank", "expose RIDER", "load /rider.html", "ready"), log)
    }

    @Test
    fun `while the last page is cleared only the blank page may load`() {
        opener.open(Mode.RIDER)
        assertEquals(true, opener.mayShow(blank))
        for (page in ModePolicy.pages(Mode.RIDER) + ModePolicy.pages(Mode.INSTRUCTOR)) assertEquals(page, false, opener.mayShow(page))
        opener.committed(blank)
        // Then the mode's own pages decide (ModePolicy.mayShow).
        assertNull(opener.mayShow(blank))
        assertNull(opener.mayShow("/rider.html"))
    }

    @Test
    fun `reports after the start page, or with nothing opening, change nothing`() {
        opener.committed(blank)
        opener.committed("/rider.html")
        assertTrue(log.isEmpty())
        assertNull(opener.mayShow(blank))
        opener.open(Mode.RIDER)
        opener.committed(blank)
        opener.committed("/rider.html")
        log.clear()
        opener.committed(blank)
        opener.committed("/rider.html")
        assertTrue(log.isEmpty())
        assertFalse(exposed == null)
    }
}
