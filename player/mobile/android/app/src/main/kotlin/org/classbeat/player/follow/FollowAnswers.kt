package org.classbeat.player.follow

/**
 * The answers the follow intents give the page (issue #632). Pure: no Android import. A reading
 * becomes the fields the page's music link needs (player/mobile/src/follow/reading.ts turns them
 * into an Observation) and nothing else: no app name, no artwork, no notification text. Anything
 * the system gives that cannot be used is dropped, never passed on as it came.
 */
object FollowAnswers {
    /** Titles and artists longer than this are cut: the page shows them, it does not need more. */
    const val MAX_TEXT = 200

    /** A track id is a short run of these characters; anything else is no id at all. */
    private val TRACK_ID = Regex("[A-Za-z0-9:._-]{1,128}")

    fun state(state: String): Map<String, Any?> = mapOf("state" to state)

    /** The answer to `followAccess`. */
    fun access(granted: Boolean): Map<String, Any?> = mapOf("granted" to granted)

    /**
     * The answer to `reading` while following: [status] and, with a usable reading, its fields.
     * [now] is the same elapsed-realtime clock as [SourceReading.positionAt]; `ageMs` is how long
     * ago the position was set, so the page can date it on its own clock.
     */
    fun reading(status: SourceStatus, reading: SourceReading?, now: Long): Map<String, Any?> = when (status) {
        SourceStatus.UNAVAILABLE -> state(UNAVAILABLE)
        SourceStatus.NOTHING -> state(NOTHING)
        SourceStatus.READING -> fields(reading, now)?.let { mapOf("state" to READING, "reading" to it) } ?: state(NOTHING)
    }

    /** The reading's fields, or null when it names no track or its numbers cannot be used. */
    fun fields(r: SourceReading?, now: Long): Map<String, Any?>? {
        if (r == null || r.positionMs < 0 || r.positionAt < 0 || r.positionAt > now) return null
        val title = text(r.title)
        val id = r.trackId?.takeIf { TRACK_ID.matches(it) }
        if (title.isEmpty() && id == null) return null
        return mapOf(
            "trackId" to id,
            "title" to title,
            "artist" to text(r.artist),
            "lengthMs" to r.lengthMs?.takeIf { it > 0 },
            "playing" to r.playing,
            "positionMs" to r.positionMs,
            "ageMs" to now - r.positionAt,
        )
    }

    /** Control characters out, trimmed and cut to [MAX_TEXT]. */
    private fun text(s: String): String = s.filterNot { it.isISOControl() }.trim().take(MAX_TEXT)

    const val FOLLOWING = "following"
    const val STOPPED = "stopped"
    const val NO_ACCESS = "noAccess"
    const val UNAVAILABLE = "unavailable"
    const val NOTHING = "nothing"
    const val READING = "reading"
}
