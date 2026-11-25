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

        /** "Display, no class open": the idle stage. */
        IDLE(IDLE_PAGE),
    }

    /**
     * What the external display shows. Only in instructor mode, with a presentation display connected
     * and the app in the foreground: the room screen while the phone is on the class page, the idle
     * stage on every other page. Rider mode never presents, nor does the background, nor the app
     * between modes ([mode] null) or before any page committed ([path] null). The phone's own screen
     * does not depend on it: a display that goes away leaves the class running on the phone, and one
     * that comes back presents again.
     */
    fun shown(mode: Mode?, path: String?, displayPresent: Boolean, foreground: Boolean): Shown = when {
        mode != Mode.INSTRUCTOR || !displayPresent || !foreground || path == null -> Shown.NONE
        path == ROOM_PAGE -> Shown.ROOM
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
