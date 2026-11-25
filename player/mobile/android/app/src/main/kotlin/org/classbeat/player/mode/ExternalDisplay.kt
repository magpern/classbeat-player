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
 *
 * A dead web view is presented again at most once per show (issue #752): a second crash with the same
 * display, page and mode leaves the display down until one of them changes. The callbacks of a show
 * that is no longer the current one (posted before a re-show) are ignored.
 */
class ExternalDisplay(private val source: DisplaySource, private val surface: RoomSurface) {
    private var shownOn: Int? = null
    private var shownPage: String? = null
    private var mode: Mode? = null
    private var path: String? = null
    private var foreground = false

    /** Counts the shows, so a callback can tell whether its show is still the current one. */
    private var generation = 0

    /** The display, page and mode of the last crash, and whether it was re-presented already. */
    private var crashedAt: Showing? = null
    private var represented = false

    private data class Showing(val display: Int, val page: String, val mode: Mode?)

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
        val wanted = Showing(display, page, mode)
        if (crashedAt != null && crashedAt != wanted) {
            // A change of display, page or mode: a new show, with its own re-present.
            crashedAt = null
            represented = false
        }
        if (represented && crashedAt == wanted && shownOn == null) return
        if (shownOn == display) {
            if (shownPage != page) surface.load(page).also { shownPage = page }
            return
        }
        hide()
        shownOn = display
        shownPage = page
        val show = ++generation
        surface.show(display, page, { if (show == generation) lost() }, { if (show == generation) crashed() })
    }

    /** The system took it down: not shown; the next display or page event decides again. */
    private fun lost() {
        generation++
        shownOn = null
        shownPage = null
    }

    /**
     * The web view died: take the presentation down and, the first time for this display, page and mode,
     * present again if the policy still says so. The second time it stays down.
     */
    private fun crashed() {
        val at = Showing(shownOn ?: return, shownPage ?: return, mode)
        represented = crashedAt == at
        crashedAt = at
        hide()
        sync()
    }

    private fun hide() {
        if (shownOn == null) return
        generation++
        shownOn = null
        shownPage = null
        surface.dismiss()
    }
}
