package org.classbeat.spike

/** Spike 1's `PlayState`. */
enum class PlayState(val json: String) { PLAYING("playing"), PAUSED("paused"), STOPPED("stopped") }

/**
 * What Android's session gives us, copied out of `MediaMetadata` and `PlaybackState` by the app
 * module. All times are `SystemClock.elapsedRealtime()` milliseconds.
 */
data class RawSession(
    /** `MediaMetadata.METADATA_KEY_MEDIA_ID`; Spotify gives `spotify:track:<id>`. */
    val mediaId: String?,
    val title: String?,
    val artist: String?,
    /** `MediaMetadata.METADATA_KEY_DURATION`; 0 or negative when unknown. */
    val durationMs: Long?,
    /** A `PlaybackState.STATE_*` constant; null when the session has no playback state. */
    val playbackState: Int?,
    /** `PlaybackState.getPosition()`: the position at [positionUpdatedAtMs]. -1 when unknown. */
    val positionMs: Long,
    /** `PlaybackState.getLastPositionUpdateTime()`: when [positionMs] was true. */
    val positionUpdatedAtMs: Long,
)

/** Spike 1's `Reading` (player/spikes/music-follower/src/core/types.ts). */
data class Reading(
    val trackId: String?,
    val title: String,
    val artist: String,
    val positionMs: Long,
    val durationMs: Long?,
    val state: PlayState,
    val readAtMs: Long,
    val polledAtMs: Long,
    val source: String,
    val app: String?,
)

const val SOURCE = "android-media-session"
