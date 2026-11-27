package org.classbeat.player.mode

import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakePorts
import org.classbeat.player.fake.FakeStore
import org.classbeat.player.pairing.PairingMachine.Notice
import org.classbeat.player.pairing.PairingProtocol
import org.classbeat.player.pairing.PairingService
import org.classbeat.player.pairing.PairingView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pairing screen opens the pair page only on "Open the site" (docs/design/app-pairing.md, item 5; #944). */
class PairingUiTest {
    private val backend = FakeBackend()
    private val ports = FakePorts()
    private val screens = FakeScreens()
    private val ticker = FakeTicker()
    private val secure = FakeSecure()

    private class FakeScreens : PairingScreens {
        var keys: List<ModeScreens.Key> = emptyList()
        var hidden = 0
        var shown = 0
        var retexts = 0

        /** False: the screen cannot change its words in place and must be shown anew. */
        var retextWorks = true

        override fun screen(lead: List<ScreenLine>, act: List<ScreenLine>, keys: List<ModeScreens.Key>) {
            this.keys = keys
            shown++
        }

        override fun retext(lines: List<ScreenLine>): Boolean {
            retexts++
            return retextWorks
        }

        override fun hide() {
            hidden++
        }

        fun press(label: String) = keys.single { it.label == label }.press()

        val labels get() = keys.map { it.label }
    }

    private class FakeTicker : Ticker {
        var due: Runnable? = null

        override fun after(ms: Long, run: Runnable) {
            due = run
        }

        override fun cancel(run: Runnable) {
            if (due === run) due = null
        }
    }

    private class FakeSecure : SecureFlag {
        val set = mutableListOf<Boolean>()

        override fun secure(on: Boolean) {
            set += on
        }
    }

    /** The code is on the screen: start answered, every poll still pending. */
    private fun codeShowing(): Pair<PairingUi, PairingService> {
        backend.route = { r -> if (r.path == "/api/pairing/start") FakeBackend.started() else FakeBackend.error(400, PairingProtocol.PENDING) }
        val service = PairingService(ORIGIN, false, "1.0.0", backend, FakeStore(), ports)
        val ui = PairingUi(screens, service, ports, secure, ticker) { true }
        service.changed = ui::changed
        service.load()
        ui.open(instructor = true) {}
        backend.flush()
        assertTrue(service.view() is PairingView.Waiting)
        return ui to service
    }

    @Test
    fun `the code arrives and the page does not open`() {
        val (ui, _) = codeShowing()
        assertEquals(listOf("Open the site", "Cancel"), screens.labels)
        assertEquals(emptyList<String>(), ports.opened)
        // The countdown, a poll and a return to the app change nothing about that.
        ticker.due!!.run()
        ports.fireNext()
        backend.flush()
        ui.resumed()
        assertEquals(emptyList<String>(), ports.opened)
    }

    @Test
    fun `Open the site opens the page exactly once per press`() {
        val (ui, _) = codeShowing()
        screens.press("Open the site")
        assertEquals(listOf("$ORIGIN/pair"), ports.opened)
        // Back from the browser: the key says "again", and only another press opens it again.
        ui.resumed()
        assertEquals(listOf("$ORIGIN/pair"), ports.opened)
        screens.press("Open the page again")
        assertEquals(listOf("$ORIGIN/pair", "$ORIGIN/pair"), ports.opened)
    }

    @Test
    fun `no browser keeps the code on the screen`() {
        val (_, service) = codeShowing()
        ports.opens = false
        screens.press("Open the site")
        assertEquals(listOf("$ORIGIN/pair"), ports.opened)
        assertTrue(service.view() is PairingView.Waiting)
        assertEquals(listOf("Open the site", "Cancel"), screens.labels)
    }

    @Test
    fun `only a pair-again keeps its save-failed plate on a drop`() {
        for (instructor in listOf(false, true)) {
            screens.keys = emptyList()
            secure.set.clear()
            backend.route = { r ->
                when (r.path) {
                    "/api/pairing/start" -> FakeBackend.started()
                    "/api/pairing/token" -> FakeBackend.token()
                    else -> FakeBackend.status(204)
                }
            }
            val service = PairingService(ORIGIN, false, "1.0.0", backend, FakeStore(saves = false), ports)
            val ui = PairingUi(screens, service, ports, secure, ticker) { true }
            service.changed = ui::changed
            // As on the phone: the token is forgotten, the mode switch runs, and it drops the screen.
            service.forgotten = ui::drop
            service.load()
            ui.open(instructor) {}
            backend.flush()
            ports.fireNext()
            backend.flush()
            assertEquals(instructor, ui.showing)
            assertNull(ticker.due)
            if (instructor) {
                // Held: the switching screen stays until the new page is ready, then the plate is back.
                assertEquals(PairingView.Unpaired(Notice.SAVE_FAILED), service.view())
                assertTrue(screens.labels != listOf("Start again", "Rider mode"))
                assertEquals(listOf(true), secure.set)
                assertTrue(ui.pageReady())
                assertEquals(listOf("Start again", "Rider mode"), screens.labels)
                // Its keys now lead from rider mode: "Rider mode" closes it and the notice is seen.
                screens.press("Rider mode")
                assertFalse(ui.showing)
                assertEquals(PairingView.Unpaired(null), service.view())
            } else {
                assertEquals(PairingView.Unpaired(null), service.view())
                assertFalse(ui.pageReady())
            }
            assertEquals(listOf(true, false), secure.set)
        }
    }

    @Test
    fun `closing the screen cancels its tick`() {
        val (ui, _) = codeShowing()
        assertNotNull(ticker.due)
        ui.back()
        assertNull(ticker.due)
        assertFalse(ui.showing)
    }

    @Test
    fun `dropping the screen cancels its tick`() {
        val (ui, _) = codeShowing()
        assertNotNull(ticker.due)
        ui.drop()
        assertNull(ticker.due)
        assertFalse(ui.showing)
        assertEquals(0, screens.hidden)
    }

    @Test
    fun `the countdown changes its words in place, and shows anew when it cannot`() {
        codeShowing()
        val shown = screens.shown
        val retexts = screens.retexts
        ticker.due!!.run()
        assertEquals(shown, screens.shown)
        assertEquals(retexts + 1, screens.retexts)
        assertNotNull(ticker.due)
        screens.retextWorks = false
        ticker.due!!.run()
        assertEquals(shown + 1, screens.shown)
        assertEquals(listOf("Open the site", "Cancel"), screens.labels)
    }

    @Test
    fun `the window is secure while the pairing screen shows`() {
        val (ui, _) = codeShowing()
        assertEquals(listOf(true), secure.set)
        ui.back()
        assertEquals(listOf(true, false), secure.set)
    }
}
