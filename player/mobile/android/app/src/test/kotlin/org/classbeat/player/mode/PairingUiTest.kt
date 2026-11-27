package org.classbeat.player.mode

import org.classbeat.player.fake.FakeBackend
import org.classbeat.player.fake.FakeBackend.Companion.ORIGIN
import org.classbeat.player.fake.FakePorts
import org.classbeat.player.fake.FakeStore
import org.classbeat.player.pairing.PairingProtocol
import org.classbeat.player.pairing.PairingService
import org.classbeat.player.pairing.PairingView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pairing screen opens the pair page only on "Open the site" (docs/design/app-pairing.md, item 5; #944). */
class PairingUiTest {
    private val backend = FakeBackend()
    private val ports = FakePorts()
    private val screens = FakeScreens()
    private val ticker = FakeTicker()

    private class FakeScreens : PairingScreens {
        var keys: List<ModeScreens.Key> = emptyList()
        var hidden = 0

        override fun screen(lead: List<ScreenLine>, act: List<ScreenLine>, keys: List<ModeScreens.Key>) {
            this.keys = keys
        }

        override fun retext(lines: List<ScreenLine>) = true

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

    /** The code is on the screen: start answered, every poll still pending. */
    private fun codeShowing(): Pair<PairingUi, PairingService> {
        backend.route = { r -> if (r.path == "/api/pairing/start") FakeBackend.started() else FakeBackend.error(400, PairingProtocol.PENDING) }
        val service = PairingService(ORIGIN, false, "1.0.0", backend, FakeStore(), ports)
        val ui = PairingUi(screens, service, ports, ticker) { true }
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
}
