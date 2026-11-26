package org.classbeat.player.follow

/**
 * The phone's [MusicSource] (ADR 0011 §6, issue #653) over the system's media sessions, seen
 * through the [Sessions] port. Pure: no Android import, so the JVM tests drive it with fake
 * sessions. It reads one app's sessions only ([Sessions.app]): every other session is passed over
 * on its package name alone, before anything of it is read. The port's Android side
 * (SpotifySessionReader.kt) filters the same way before it hands a session over; this is the
 * second check, the one a test can see. Nothing is read before [start] or after [stop], and only
 * the last reading is kept.
 */
class SessionReader(private val sessions: Sessions) : MusicSource {
    private var started = false
    private var last: SourceReading? = null

    override fun start() {
        started = true
    }

    override fun stop() {
        started = false
        last = null
    }

    /**
     * Refreshes the reading while started. UNAVAILABLE only when the phone has no media sessions at
     * all: not while the listener is unbound or access is missing (the list is null then), or the
     * instructor would never be offered the setting (Follower.follow asks this first).
     */
    override fun status(): SourceStatus {
        if (!sessions.exists()) {
            last = null
            return SourceStatus.UNAVAILABLE
        }
        if (!started) return SourceStatus.NOTHING
        last = read()
        return if (last == null) SourceStatus.NOTHING else SourceStatus.READING
    }

    /** The reading [status] last took, while started. */
    override fun latest(): SourceReading? = if (started) last else null

    /**
     * Start, pause or next, sent through the music app's own session (ADR 0001's transport), and
     * only while following. False when there is no such session to send it to.
     */
    fun command(command: TransportCommand): Boolean {
        if (!started || !sessions.exists()) return false
        val session = mine() ?: return false
        session.send(command)
        return true
    }

    private fun read(): SourceReading? {
        val session = mine() ?: return null
        val track = session.track() ?: return null
        val state = session.state() ?: return null
        return SourceReading(track.id, track.title, track.artist, track.lengthMs, state.playing, state.positionMs, state.positionAt)
    }

    /** The first of the music app's sessions, chosen on the package name before anything is read. */
    private fun mine(): Session? = sessions.active()?.firstOrNull { it.app == sessions.app }
}

/** The media sessions the system lists. */
interface Sessions {
    /** The one app whose sessions may be read. */
    val app: String

    /** False when this phone has no media sessions at all: it can never follow. */
    fun exists(): Boolean

    /** [app]'s active sessions, or null while they may not be listed (no access, listener unbound). */
    fun active(): List<Session>?
}

/** One session. [app] is known without reading it; [track], [state] and [send] are the reads and the one write. */
interface Session {
    val app: String

    fun track(): SessionTrack?

    fun state(): SessionState?

    fun send(command: TransportCommand)
}

/** The track identity a session gives: nothing else of its metadata is read. */
data class SessionTrack(val id: String?, val title: String, val artist: String, val lengthMs: Long?)

/** Playing or not, and the position with the elapsed-realtime moment (ms) the system set it. */
data class SessionState(val playing: Boolean, val positionMs: Long, val positionAt: Long)

enum class TransportCommand { PLAY, PAUSE, NEXT }
