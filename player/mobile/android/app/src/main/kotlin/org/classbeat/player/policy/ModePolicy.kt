package org.classbeat.player.policy

// The app's two modes and the rules for moving between them (ADR 0011 section 1, issue #630).
// Pure: no Android import. The mode itself is held by mode/ModeHolder.kt; this file only decides.

/** The app is one install with two modes. RIDER is the safe one: nothing of an instructor's in it. */
enum class Mode(val stored: String, val plugin: String) {
    RIDER("rider", "RiderMode"),
    INSTRUCTOR("instructor", "InstructorMode"),
}

object ModePolicy {
    /** What pressing "Switch to instructor mode" in rider mode leads to. */
    enum class Entry {
        /** An unpaired device: pairing (ADR 0011 section 5, issue #631). */
        PAIR,

        /** A paired device with no secure screen lock: no instructor mode; say a lock is needed. */
        NO_LOCK,

        /** A paired device with a secure screen lock: the system's screen-lock confirmation, every time. */
        ASK_LOCK,
    }

    /**
     * The mode the app opens in: the last mode used, read from native storage. Instructor mode only
     * when it was the last mode and the device is still paired and still has a secure screen lock;
     * anything else, a first launch and an unreadable value included, opens in rider mode.
     */
    fun startMode(stored: String?, paired: Boolean, secureLock: Boolean): Mode =
        if (stored == Mode.INSTRUCTOR.stored && paired && secureLock) Mode.INSTRUCTOR else Mode.RIDER

    /** The way into instructor mode from rider mode. It never opens instructor mode by itself. */
    fun entry(paired: Boolean, secureLock: Boolean): Entry = when {
        !paired -> Entry.PAIR
        !secureLock -> Entry.NO_LOCK
        else -> Entry.ASK_LOCK
    }

    /**
     * Whether a screen-lock answer opens instructor mode: only an answer to a prompt this app asked
     * for, that passed, on a device that is still paired and still has a secure lock.
     */
    fun opensInstructor(asked: Boolean, passed: Boolean, paired: Boolean, secureLock: Boolean): Boolean =
        asked && passed && paired && secureLock

    /** The bundled pages each mode may show in its main frame. Each mode's first page is its start page. */
    fun pages(mode: Mode): List<String> = when (mode) {
        Mode.RIDER -> listOf("/rider.html")
        Mode.INSTRUCTOR -> listOf("/instructor.html", "/room.html")
    }

    /** The start page of [mode]. */
    fun startPage(mode: Mode): String = pages(mode).first()

    /**
     * Whether a main-frame page at [path] may show while the app is in [mode]. While the app is
     * between modes ([mode] null), none may.
     */
    fun mayShow(mode: Mode?, path: String): Boolean = mode != null && path in pages(mode)

    /**
     * Everything a switch drops, in this order, in either direction: the instructor's music follower,
     * its host and controller connections and its state, then the rider's session and the rider's
     * remembered numbers (FTP and maximum heart rate, ADR 0007), and last the web view's storage.
     * A holder that is not given exactly these refuses to start.
     */
    val TEARDOWN: List<String> = listOf(
        "follower",
        "connections",
        "instructorState",
        "riderSession",
        "riderNumbers",
        "webStorage",
    )
}
