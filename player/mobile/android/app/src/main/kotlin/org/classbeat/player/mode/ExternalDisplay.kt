package org.classbeat.player.mode

import org.classbeat.player.policy.ExternalDisplayPolicy
import org.classbeat.player.policy.Mode

/** The display service, as the presenter needs it. The Android edge implements it with DisplayManager. */
interface DisplaySource {
    /** The ids of the presentation displays connected now (HDMI, USB-C, a cast display), never the phone's own. */
    fun presentationDisplays(): List<Int>

    /** Calls [changed] on the main thread whenever a display is added, removed or changed. */
    fun listen(changed: () -> Unit)

    fun stopListening()
}

/** What shows the room screen on a display. The Android edge implements it with a Presentation. */
interface RoomSurface {
    /**
     * Shows [page] full screen on display [id]. [gone] is called if the system dismisses it;
     * [crashed] if its web view's render process died (the surface is then still up: dismiss it).
     */
    fun show(id: Int, page: String, gone: () -> Unit, crashed: () -> Unit)

    /** Shows [page] on the display it is already on, without taking it down. */
    fun load(page: String)

    /** Takes the room screen down and frees its web view. */
    fun dismiss()
}

/**
 * Keeps the room screen on the external display in step with [ExternalDisplayPolicy] (issue #738).
 * The phone's own screen is never touched here: dismissing leaves the class running on it. Every
 * method runs on the main thread, and every call is idempotent.
 */
class ExternalDisplay(private val source: DisplaySource, private val surface: RoomSurface) {
    private var shownOn: Int? = null
    private var shownPage: String? = null
    private var mode: Mode? = null
    private var path: String? = null
    private var foreground = false

    /** Starts watching the displays. */
    fun start() = source.listen(::sync)

    /** The inputs of the policy, as the mode controller knows them. */
    fun update(mode: Mode?, path: String?, foreground: Boolean) {
        this.mode = mode
        this.path = path
        this.foreground = foreground
        sync()
    }

    /** The app is going away: the room screen comes down and the displays are no longer watched. */
    fun stop() {
        source.stopListening()
        hide()
    }

    private fun sync() {
        val display = source.presentationDisplays().firstOrNull()
        val page = ExternalDisplayPolicy.shown(mode, path, display != null, foreground).page
        if (display == null || page == null) return hide()
        if (shownOn == display) {
            if (shownPage != page) surface.load(page).also { shownPage = page }
            return
        }
        hide()
        shownOn = display
        shownPage = page
        surface.show(display, page, ::lost, ::crashed)
    }

    /** The system took it down: not shown; the next display or page event decides again. */
    private fun lost() {
        shownOn = null
        shownPage = null
    }

    /** The web view died: take the presentation down, and present again if the policy still says so. */
    private fun crashed() {
        hide()
        sync()
    }

    private fun hide() {
        if (shownOn == null) return
        shownOn = null
        shownPage = null
        surface.dismiss()
    }
}
