package org.classbeat.player.mode

import org.classbeat.player.policy.Mode
import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeDisplays : DisplaySource {
    var ids = mutableListOf<Int>()
    var changed: (() -> Unit)? = null

    override fun presentationDisplays() = ids.toList()

    override fun listen(changed: () -> Unit) {
        this.changed = changed
    }

    override fun stopListening() {
        changed = null
    }

    fun connect(id: Int) {
        ids.add(id)
        changed?.invoke()
    }

    fun disconnect(id: Int) {
        ids.remove(id)
        changed?.invoke()
    }
}

private class FakeSurface : RoomSurface {
    val log = mutableListOf<String>()
    var gone: (() -> Unit)? = null
    var crashed: (() -> Unit)? = null

    override fun show(id: Int, page: String, gone: () -> Unit, crashed: () -> Unit) {
        log.add("show $id $page")
        this.gone = gone
        this.crashed = crashed
    }

    override fun load(page: String) {
        log.add("load $page")
    }

    override fun dismiss() {
        log.add("dismiss")
    }
}

class ExternalDisplayTest {
    private val displays = FakeDisplays()
    private val surface = FakeSurface()
    private val ext = ExternalDisplay(displays, surface).also { it.start() }

    private fun classOpen() = ext.update(Mode.INSTRUCTOR, "/room.html", foreground = true)

    @Test
    fun `a display connected during a class shows the room screen`() {
        classOpen()
        assertEquals(emptyList<String>(), surface.log)
        displays.connect(2)
        assertEquals(listOf("show 2 /room.html"), surface.log)
    }

    @Test
    fun `a display already there shows the idle stage on the class list, then the room screen when the class opens`() {
        displays.connect(2)
        ext.update(Mode.INSTRUCTOR, "/instructor.html", foreground = true)
        assertEquals(listOf("show 2 /display.html"), surface.log)
        classOpen()
        assertEquals(listOf("show 2 /display.html", "load /room.html"), surface.log)
        ext.update(Mode.INSTRUCTOR, "/instructor.html", foreground = true)
        assertEquals(listOf("show 2 /display.html", "load /room.html", "load /display.html"), surface.log)
    }

    @Test
    fun `disconnect mid-class dismisses, and reconnect shows again`() {
        classOpen()
        displays.connect(2)
        displays.disconnect(2)
        assertEquals(listOf("show 2 /room.html", "dismiss"), surface.log)
        displays.connect(3)
        assertEquals(listOf("show 2 /room.html", "dismiss", "show 3 /room.html"), surface.log)
    }

    @Test
    fun `rider mode and the app between modes show the idle stage, never the room screen`() {
        displays.connect(2)
        ext.update(Mode.RIDER, "/rider.html", foreground = true)
        ext.update(Mode.RIDER, "/room.html", foreground = true)
        assertEquals(listOf("show 2 /display.html"), surface.log)
        classOpen()
        ext.update(null, null, foreground = true)
        assertEquals(listOf("show 2 /display.html", "load /room.html", "load /display.html"), surface.log)
        ext.update(Mode.RIDER, null, foreground = false)
        assertEquals(listOf("show 2 /display.html", "load /room.html", "load /display.html", "dismiss"), surface.log)
    }

    @Test
    fun `going to the background dismisses and coming back shows again`() {
        displays.connect(2)
        classOpen()
        ext.update(Mode.INSTRUCTOR, "/room.html", foreground = false)
        classOpen()
        assertEquals(listOf("show 2 /room.html", "dismiss", "show 2 /room.html"), surface.log)
    }

    @Test
    fun `repeated updates and events show it once, and a second display changes nothing`() {
        displays.connect(2)
        classOpen()
        classOpen()
        displays.connect(5)
        assertEquals(listOf("show 2 /room.html"), surface.log)
    }

    @Test
    fun `a presentation the system dismissed is shown again on the next change`() {
        displays.connect(2)
        classOpen()
        surface.gone!!.invoke()
        classOpen()
        assertEquals(listOf("show 2 /room.html", "show 2 /room.html"), surface.log)
    }

    @Test
    fun `a dead render process takes the presentation down and shows it again while the policy says so`() {
        displays.connect(2)
        classOpen()
        surface.crashed!!.invoke()
        assertEquals(listOf("show 2 /room.html", "dismiss", "show 2 /room.html"), surface.log)
        ext.update(Mode.INSTRUCTOR, "/room.html", foreground = false)
        surface.crashed!!.invoke()
        assertEquals(listOf("show 2 /room.html", "dismiss", "show 2 /room.html", "dismiss"), surface.log)
    }

    @Test
    fun `a second crash on the same display, page and mode stays down until one of them changes`() {
        displays.connect(2)
        classOpen()
        surface.crashed!!.invoke()
        surface.crashed!!.invoke()
        val down = listOf("show 2 /room.html", "dismiss", "show 2 /room.html", "dismiss")
        assertEquals(down, surface.log)
        // The same inputs again, a display event, and a trip to the background and back: still down.
        classOpen()
        displays.connect(5)
        ext.update(Mode.INSTRUCTOR, "/room.html", foreground = false)
        classOpen()
        assertEquals(down, surface.log)
        // A change of page shows again, with its own re-present.
        ext.update(Mode.INSTRUCTOR, "/instructor.html", foreground = true)
        assertEquals(down + "show 2 /display.html", surface.log)
        surface.crashed!!.invoke()
        assertEquals(down + listOf("show 2 /display.html", "dismiss", "show 2 /display.html"), surface.log)
    }

    @Test
    fun `after a second crash, a change of display or of mode shows again`() {
        displays.connect(2)
        ext.update(Mode.INSTRUCTOR, "/instructor.html", foreground = true)
        surface.crashed!!.invoke()
        surface.crashed!!.invoke()
        displays.disconnect(2)
        displays.connect(3)
        assertEquals("show 3 /display.html", surface.log.last())
        surface.crashed!!.invoke()
        surface.crashed!!.invoke()
        val down = surface.log.toList()
        ext.update(Mode.RIDER, "/rider.html", foreground = true)
        assertEquals(down + "show 3 /display.html", surface.log)
    }

    @Test
    fun `a crash or a dismissal reported late, by a show that is no longer current, is ignored`() {
        displays.connect(2)
        classOpen()
        val firstCrashed = surface.crashed!!
        val firstGone = surface.gone!!
        firstCrashed()
        val reshown = listOf("show 2 /room.html", "dismiss", "show 2 /room.html")
        assertEquals(reshown, surface.log)
        // The first show's callbacks again, after the re-show: nothing comes down, and the budget is not spent.
        firstCrashed()
        firstGone()
        classOpen()
        assertEquals(reshown, surface.log)
        surface.crashed!!.invoke()
        assertEquals(reshown + "dismiss", surface.log)
        // A callback of a presentation already dismissed changes nothing either.
        surface.crashed!!.invoke()
        surface.gone!!.invoke()
        assertEquals(reshown + "dismiss", surface.log)
    }

    @Test
    fun `dismissing without a display on show does nothing, and stop dismisses and stops listening`() {
        classOpen()
        displays.disconnect(9)
        assertEquals(emptyList<String>(), surface.log)
        displays.connect(2)
        ext.stop()
        assertEquals(listOf("show 2 /room.html", "dismiss"), surface.log)
        displays.connect(3)
        assertEquals(listOf("show 2 /room.html", "dismiss"), surface.log)
    }
}
