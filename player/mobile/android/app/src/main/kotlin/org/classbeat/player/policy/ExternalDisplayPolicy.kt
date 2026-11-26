package org.classbeat.player.policy

// What shows on the external display (issue #738, docs/design/app-room-display.md). Pure: no Android
// import. The display listener and the Presentation are mode/ExternalDisplay's; this file only decides.
//
// The room screen opens a class only through the bridge (issue #871: room.html?id=, then getClass), and
// the presentation's web view has no bridge, so the display keeps the idle stage while a class runs on
// the phone. Showing the open class there is a later issue.

object ExternalDisplayPolicy {
    /** The dark stage with its one line (display.html: no bridge, no data). */
    const val IDLE_PAGE = "/display.html"

    /** The same stage with the rider's line, for rider mode (issue #759). Chosen by the mode alone. */
    const val IDLE_RIDER_PAGE = "/display-rider.html"

    enum class Shown(val page: String?) {
        /** Nothing: no presentation. */
        NONE(null),

        /** Instructor mode, with or without a class open on the phone, and between modes: the idle stage with the instructor's line. */
        IDLE(IDLE_PAGE),

        /** Rider mode: the idle stage with "Your class is on your phone". */
        IDLE_RIDER(IDLE_RIDER_PAGE),
    }

    /**
     * What the external display shows (issue #752). With a presentation display connected and the app in
     * the foreground, always a page of our own, so Android never mirrors the phone there: the idle stage,
     * with the rider's line in rider mode and the instructor's otherwise, a class open on the phone, the
     * app between modes ([mode] null) and before any page committed ([path] null) included (issue #871).
     * [path] no longer changes what shows; it stays an input so the caller need not know that. The
     * background presents nothing. The phone's own screen does not depend on it: a display that goes away
     * leaves the class running on the phone, and one that comes back presents again.
     */
    @Suppress("UNUSED_PARAMETER")
    fun shown(mode: Mode?, path: String?, displayPresent: Boolean, foreground: Boolean): Shown = when {
        !displayPresent || !foreground -> Shown.NONE
        mode == Mode.RIDER -> Shown.IDLE_RIDER
        else -> Shown.IDLE
    }

    /**
     * Whether the presentation's web view may load [url]: the bundle's own files only, and in the main
     * frame an idle page only. Inner frames may load any bundle file (the page's CSP allows none); there
     * is no link or other page to go to.
     */
    fun mayLoad(url: String, mainFrame: Boolean): Boolean {
        if (!NavigationPolicy.serves(url)) return false
        if (!mainFrame) return true
        val path = NavigationPolicy.decodePath(url.substringAfter("//localhost").substringBefore('?').substringBefore('#'))
        return path == IDLE_PAGE || path == IDLE_RIDER_PAGE
    }
}
