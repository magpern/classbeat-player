package org.classbeat.player.follow

/**
 * What the phone can tell about the music the instructor's music app is playing (ADR 0011 §6,
 * issue #632): the track, whether it plays, and its position with the moment the system set it.
 * Nothing here reads, plays or stores audio. The only implementation for now is [UnavailableSource]:
 * the real reader is issue #653, so following stays on the manual clock until it lands.
 */
interface MusicSource {
    /** Begin reading. Called only once notification access is granted, in instructor mode. */
    fun start()

    /** Stop reading and forget the last reading. Safe to call at any time, more than once. */
    fun stop()

    fun status(): SourceStatus

    /** The latest reading, or null when there is none (see [status]). */
    fun latest(): SourceReading?
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

/** The stand-in until issue #653: it never reads anything and always says it cannot follow. */
object UnavailableSource : MusicSource {
    override fun start() {}

    override fun stop() {}

    override fun status() = SourceStatus.UNAVAILABLE

    override fun latest(): SourceReading? = null
}
