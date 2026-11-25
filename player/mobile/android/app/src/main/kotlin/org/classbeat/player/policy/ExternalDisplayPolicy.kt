package org.classbeat.player.policy

// What shows on the external display (issue #738, docs/design/app-room-display.md). Pure: no Android
// import. The display listener and the Presentation are mode/ExternalDisplay's; this file only decides.

object ExternalDisplayPolicy {
    /** The room screen, as the phone's class page shows it. */
    const val ROOM_PAGE = KeepAwakePolicy.CLASS_PAGE

    /** The dark stage with its one line, for a display with no class open (display.html: no bridge, no data). */
    const val IDLE_PAGE = "/display.html"

    enum class Shown(val page: String?) {
        /** Nothing: no presentation. */
        NONE(null),

        /** "Display, class open": the room screen. */
        ROOM(ROOM_PAGE),

        /** "Display, no class open", rider mode and between modes: the idle stage. */
        IDLE(IDLE_PAGE),
    }

    /**
     * What the external display shows (issue #752). With a presentation display connected and the app in
     * the foreground, always a page of our own, so Android never mirrors the phone there: the room screen
     * while instructor mode is on the class page, and the idle stage in every other case, rider mode and
     * the app between modes ([mode] null) or before any page committed ([path] null) included. The
     * background presents nothing. The phone's own screen does not depend on it: a display that goes away
     * leaves the class running on the phone, and one that comes back presents again.
     */
    fun shown(mode: Mode?, path: String?, displayPresent: Boolean, foreground: Boolean): Shown = when {
        !displayPresent || !foreground -> Shown.NONE
        mode == Mode.INSTRUCTOR && path == ROOM_PAGE -> Shown.ROOM
        else -> Shown.IDLE
    }

    /**
     * Whether the presentation's web view may load [url]: the bundle's own files only, and in the main
     * frame the room page or the idle page only. Inner frames may load any bundle file (the page's CSP
     * allows none); there is no link or other page to go to.
     */
    fun mayLoad(url: String, mainFrame: Boolean): Boolean {
        if (!NavigationPolicy.serves(url)) return false
        if (!mainFrame) return true
        val path = NavigationPolicy.decodePath(url.substringAfter("//localhost").substringBefore('?').substringBefore('#'))
        return path == ROOM_PAGE || path == IDLE_PAGE
    }
}
