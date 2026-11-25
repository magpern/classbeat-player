package org.classbeat.player.policy

// When the phone's screen stays on (issue #737). Pure: no Android import. The window flag itself is
// set by mode/ModeController; this file only decides.

object KeepAwakePolicy {
    /** The instructor page that is the open class (ModePolicy.pages: the list is the first page). */
    const val CLASS_PAGE = "/room.html"

    /**
     * Whether the screen stays on. Only in the foreground, and only for a class that is open
     * (instructor mode on its class page) or a rider joined to a session (rider mode). Between modes
     * ([mode] null) it never does, and neither mode's state counts in the other mode.
     */
    fun keepOn(mode: Mode?, path: String?, riderJoined: Boolean, foreground: Boolean): Boolean {
        if (!foreground) return false
        return when (mode) {
            Mode.INSTRUCTOR -> path == CLASS_PAGE
            Mode.RIDER -> riderJoined
            null -> false
        }
    }
}
