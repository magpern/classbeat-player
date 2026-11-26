package org.classbeat.player.follow

/**
 * What the phone can tell about the music the instructor's music app is playing (ADR 0011 §6,
 * issue #632): the track, whether it plays, and its position with the moment the system set it.
 * Nothing here reads, plays or stores audio, and the only commands are [TransportCommand]'s three.
 * The phone's implementation is [SessionReader] (#653).
 */
interface MusicSource {
    /** Begin reading. Called only once notification access is granted, in instructor mode. */
    fun start()

    /** Stop reading and forget the last reading. Safe to call at any time, more than once. */
    fun stop()

    fun status(): SourceStatus

    /** The latest reading, or null when there is none (see [status]). */
    fun latest(): SourceReading?

    /**
     * Play, pause or next, through the music app's own session, only while reading (issue #857).
     * False when there is no session to send it to. Nothing else is ever sent.
     */
    fun command(command: TransportCommand): Boolean
}

enum class SourceStatus {
    /** This phone cannot follow: the app stays on the manual clock. */
    UNAVAILABLE,

    /** Following works, but no music app has anything loaded. */
    NOTHING,

    /** [MusicSource.latest] has a reading. */
    READING,
}

/**
 * One reading as the system gives it. [positionAt] is the system's elapsed-realtime clock (ms) when
 * it last set [positionMs]; the page dates the reading from it (rule 8).
 */
data class SourceReading(
    val trackId: String?,
    val title: String,
    val artist: String,
    val lengthMs: Long?,
    val playing: Boolean,
    val positionMs: Long,
    val positionAt: Long,
)
