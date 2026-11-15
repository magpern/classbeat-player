package org.classbeat.spike.follower

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSessionManager
import android.os.SystemClock
import org.classbeat.spike.RawSession
import org.classbeat.spike.Reading
import org.classbeat.spike.spotifyOnly
import org.classbeat.spike.toReading
import org.classbeat.spike.whyUnreadable

/** One poll: the reading (null when there is none), why not, and the time we asked. */
class Poll(val polledAtMs: Long, val reading: Reading?, val problem: String?)

/**
 * Reads Spotify's media session and nothing else. The active sessions are filtered to Spotify's
 * package before any session's metadata or state is read, and the reader only reads: it never sends
 * a command to Spotify.
 */
class SpotifyReader(context: Context) {
    private val manager = context.getSystemService(MediaSessionManager::class.java)
    private val listener = ComponentName(context, SpikeListener::class.java)

    fun poll(): Poll {
        val polledAt = SystemClock.elapsedRealtime()
        val sessions = try {
            manager.getActiveSessions(listener)
        } catch (e: SecurityException) {
            return Poll(polledAt, null, "notification access is not granted")
        }
        val spotify = spotifyOnly(sessions) { it.packageName }.firstOrNull() ?: return Poll(polledAt, null, null)
        val metadata = spotify.metadata
        val state = spotify.playbackState
        val raw = RawSession(
            mediaId = metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
            title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE),
            artist = metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST),
            durationMs = metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION),
            playbackState = state?.state,
            positionMs = state?.position ?: -1,
            positionUpdatedAtMs = state?.lastPositionUpdateTime ?: 0,
        )
        return Poll(polledAt, toReading(raw, polledAt), whyUnreadable(raw))
    }
}
