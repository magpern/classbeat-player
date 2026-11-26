package org.classbeat.player.follow

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState

/**
 * The one file that may name Android's media-session types and the music app's package (owner,
 * 2026-11-26, ADR 0011 §8, #653; rules.test.ts pins the exception to this file). The class names
 * here avoid both, so no other file has to name them. The listed sessions are filtered to [MUSIC_APP]
 * on their package name before anything of them is read; only that app's track identity, play
 * state and position are read; transport goes through its session's own controls. Nothing here
 * plays, records, downloads or keeps audio, and nothing reaches the network.
 */
private const val MUSIC_APP = "com.spotify.music"

/**
 * [Sessions] on Android. Listing the sessions needs this app's notification listener enabled and
 * granted (ADR 0011 §6); without it the system refuses, and the list is null, never "unavailable".
 */
class AndroidSessions(context: Context) : Sessions {
    private val manager: MediaSessionManager? = context.getSystemService(MediaSessionManager::class.java)
    private val listener = ComponentName(context, FollowListener::class.java)

    override val app: String = MUSIC_APP

    override fun exists(): Boolean = manager != null

    override fun active(): List<Session>? = try {
        manager?.getActiveSessions(listener)?.filter { it.packageName == MUSIC_APP }?.map { ControllerSession(it) }
    } catch (e: SecurityException) {
        null
    }
}

/** One of the music app's sessions; each read asks the system afresh and keeps nothing. */
private class ControllerSession(private val controller: MediaController) : Session {
    override val app: String = controller.packageName

    override fun track(): SessionTrack? = controller.metadata?.let {
        SessionTrack(
            id = it.getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
            title = it.getString(MediaMetadata.METADATA_KEY_TITLE).orEmpty(),
            artist = it.getString(MediaMetadata.METADATA_KEY_ARTIST).orEmpty(),
            lengthMs = it.getLong(MediaMetadata.METADATA_KEY_DURATION).takeIf { ms -> ms > 0 },
        )
    }

    // lastPositionUpdateTime is on the elapsed-realtime clock, the clock MainActivity gives the follower.
    override fun state(): SessionState? = controller.playbackState?.let {
        SessionState(it.state == PlaybackState.STATE_PLAYING, it.position, it.lastPositionUpdateTime)
    }

    override fun send(command: TransportCommand) {
        val controls = controller.transportControls
        when (command) {
            TransportCommand.PLAY -> controls.play()
            TransportCommand.PAUSE -> controls.pause()
            TransportCommand.NEXT -> controls.skipToNext()
        }
    }
}
