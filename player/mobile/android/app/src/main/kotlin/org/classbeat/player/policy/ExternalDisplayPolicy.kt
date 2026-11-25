package org.classbeat.player.policy

// When the room screen is shown on an external display (issue #738). Pure: no Android import. The
// display listener and the Presentation are mode/ExternalDisplay's; this file only decides.

object ExternalDisplayPolicy {
    /** The one page the presentation shows: the bundled room screen, as the phone's class page shows it. */
    const val ROOM_PAGE = KeepAwakePolicy.CLASS_PAGE

    /**
     * Whether the room screen is presented on the external display. Only in instructor mode, with a
     * presentation display connected, while the class is open (the instructor's class page) and the
     * app is in the foreground. Rider mode never presents, and neither does the app between modes
     * ([mode] null). The phone's own screen does not depend on it: a display that goes away leaves the
     * class running on the phone, and a display that comes back presents again.
     */
    fun present(mode: Mode?, path: String?, displayPresent: Boolean, foreground: Boolean): Boolean =
        mode == Mode.INSTRUCTOR && displayPresent && foreground && path == ROOM_PAGE

    /**
     * Whether the presentation's web view may load [url]: the bundle's own files only, and in the main
     * frame the room page only. It has no other page, link or frame to go to.
     */
    fun mayLoad(url: String, mainFrame: Boolean): Boolean {
        if (!NavigationPolicy.serves(url)) return false
        if (!mainFrame) return true
        return NavigationPolicy.decodePath(url.substringAfter("//localhost").substringBefore('?').substringBefore('#')) == ROOM_PAGE
    }
}
