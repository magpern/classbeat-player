package org.classbeat.player.mode

import org.classbeat.player.pairing.PairingPorts
import org.classbeat.player.pairing.PairingScreenModel
import org.classbeat.player.pairing.PairingScreenModel.Action
import org.classbeat.player.pairing.PairingService
import org.classbeat.player.pairing.PairingView

/**
 * The native pairing screen (docs/design/app-pairing.md, issue #631): it starts a pairing, shows
 * [PairingScreenModel]'s screen for each state and counts the code down once a second. Opened from
 * rider mode's "Switch to instructor mode" on an unpaired phone (N3), or by "pair again" in
 * instructor mode. Main thread only.
 */
class PairingUi(
    private val screens: PairingScreens,
    private val service: PairingService,
    private val ports: PairingPorts,
    private val ticker: Ticker = MainTicker(),
    private val secureLock: () -> Boolean,
) {
    private val tick = Runnable { if (showing) render() }

    var showing = false
        private set

    private var instructor = false
    private var returned = false
    private var shown: PairingScreenModel.Screen? = null
    private var leave: (paired: Boolean) -> Unit = {}

    /** Shows the screen and starts a pairing; [leave] runs once when the screen goes, with whether a pairing was made. */
    fun open(instructor: Boolean, leave: (paired: Boolean) -> Unit) {
        this.instructor = instructor
        this.leave = leave
        returned = false
        shown = null
        showing = true
        // A notice (unpaired on the website, say) stays on its plate; "Start again" begins.
        if (PairingScreenModel.begins(service.view())) service.begin()
        render()
    }

    /** After every pairing change (PairingService.changed). */
    fun changed() {
        if (showing) render()
    }

    /** The app came back, from the browser or anywhere: a code still waiting gets the waiting line. */
    fun resumed() {
        if (!showing || service.view() !is PairingView.Waiting) return
        returned = true
        render()
    }

    /** Back is "Cancel" on every pairing screen. */
    fun back() = close(false)

    /** Closes the screen with no answer to anyone: the page that opened it is being replaced. */
    fun drop() {
        if (!showing) return
        service.cancel()
        service.seen()
        showing = false
        ticker.cancel(tick)
    }

    private fun press(action: Action) {
        when (action) {
            Action.CANCEL, Action.RIDER -> close(false)
            // The only place the page opens (docs/design/app-pairing.md, item 5). No browser: the
            // screen still shows the code and the address, to type in on another device.
            Action.OPEN -> (service.view() as? PairingView.Waiting)?.let { ports.openPage(it.page) }
            Action.START_AGAIN -> {
                returned = false
                service.begin()
            }
            Action.CONTINUE -> close(true)
        }
    }

    private fun close(paired: Boolean) {
        if (!showing) return
        // Stops an attempt that is still running; a pairing already made is kept.
        service.cancel()
        service.seen()
        showing = false
        ticker.cancel(tick)
        screens.hide()
        leave(paired)
    }

    private fun render() {
        val view = service.view()
        val screen = PairingScreenModel.screen(view, ports.now(), secureLock(), returned, instructor)
        val last = shown
        // The countdown changes in place, so the focus stays on its key; anything else shows anew.
        if (last == null || last.keys != screen.keys || !screens.retext(screen.lines)) {
            screens.screen(screen.lead, screen.act, screen.keys.map { k -> ModeScreens.Key(k.label, k.main) { press(k.action) } })
        }
        shown = screen
        ticker.cancel(tick)
        if (view is PairingView.Waiting) ticker.after(TICK_MS, tick)
    }

    private companion object {
        const val TICK_MS = 1000L
    }
}
