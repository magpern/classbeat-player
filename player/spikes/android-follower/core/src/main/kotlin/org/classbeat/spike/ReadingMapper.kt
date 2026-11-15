package org.classbeat.spike

// android.media.session.PlaybackState constants, copied so this module needs no Android classes.
private const val STATE_PAUSED = 2
private const val STATE_PLAYING = 3
private const val STATE_FAST_FORWARDING = 4
private const val STATE_REWINDING = 5

/**
 * Playing, paused or stopped. Only a state in which the position advances counts as playing.
 * Buffering, connecting and skipping (Spotify passes through them at a song change) count as paused:
 * the position does not run there. Stopped, none and error count as stopped.
 */
fun mapState(state: Int): PlayState = when (state) {
    STATE_PLAYING, STATE_FAST_FORWARDING, STATE_REWINDING -> PlayState.PLAYING
    STATE_PAUSED, 6, 8, 9, 10, 11 -> PlayState.PAUSED
    else -> PlayState.STOPPED
}

/** Why a Spotify session gave no reading, or null when it is readable. */
fun whyUnreadable(raw: RawSession): String? = when {
    raw.title == null && raw.mediaId == null -> "Spotify's session has no track information yet"
    raw.playbackState == null -> "Spotify's session has no playback state"
    raw.positionMs < 0 -> "Spotify's session does not know the playback position"
    else -> null
}

/**
 * Maps one Spotify session to spike 1's reading. `readAtMs` is the moment the position was true
 * (`lastPositionUpdateTime`), `polledAtMs` the moment we asked; spike 1's follower extrapolates a
 * playing position from `readAtMs`. An unset or future update time is replaced by `polledAtMs`.
 * Returns null when [whyUnreadable] says so or when [raw] is null (no Spotify session).
 */
fun toReading(raw: RawSession?, polledAtMs: Long): Reading? {
    if (raw == null || whyUnreadable(raw) != null) return null
    val readAt = if (raw.positionUpdatedAtMs <= 0 || raw.positionUpdatedAtMs > polledAtMs) polledAtMs else raw.positionUpdatedAtMs
    return Reading(
        trackId = raw.mediaId?.takeIf { it.isNotBlank() },
        title = raw.title ?: "",
        artist = raw.artist ?: "",
        positionMs = raw.positionMs,
        durationMs = raw.durationMs?.takeIf { it > 0 },
        state = mapState(raw.playbackState!!),
        readAtMs = readAt,
        polledAtMs = polledAtMs,
        source = SOURCE,
        app = SPOTIFY_PACKAGE,
    )
}
