package org.classbeat.player.follow

/**
 * Following the instructor's music app (ADR 0011 §6, issue #632), behind the follow intents of
 * instructor mode. Notification access is asked for only from here, so only in instructor mode
 * (IntentPolicy), and only when the instructor turns following on. Without access, or while the
 * source cannot follow, the page stays on the manual clock. [drop] is the mode holder's "follower"
 * teardown: a switch to rider mode stops the source and disables the listener. Pure apart from its
 * two ports; every method runs on the main thread.
 */
class Follower(
    private val source: MusicSource,
    private val access: ListenerAccess,
    /** The elapsed-realtime clock in ms, the one [SourceReading.positionAt] uses. */
    private val clock: () -> Long,
) {
    /** The instructor turned following on and the source is reading. */
    var following = false
        private set

    // Nothing follows from the start, whichever mode opens: the listener is off until asked for.
    init {
        drop()
    }

    fun followAccess(): Map<String, Any?> = FollowAnswers.access(access.granted())

    /**
     * Opens Android's notification-access setting for this app. The listener is enabled first, or
     * the setting would not list it; it stays enabled only while instructor mode lasts.
     */
    fun openFollowSetting(): Map<String, Any?> {
        access.enable(true)
        return FollowAnswers.state(if (access.openSetting()) "opened" else UNOPENED)
    }

    /** Turns following on: "following", or why not ("unavailable", "noAccess"). */
    fun follow(): Map<String, Any?> {
        // The reader first: a source that cannot follow must not send the instructor to the setting.
        if (source.status() == SourceStatus.UNAVAILABLE) {
            stopSource()
            return FollowAnswers.state(FollowAnswers.UNAVAILABLE)
        }
        if (!access.granted()) return FollowAnswers.state(FollowAnswers.NO_ACCESS)
        access.enable(true)
        if (!following) source.start()
        following = true
        return FollowAnswers.state(FollowAnswers.FOLLOWING)
    }

    /** Back to the manual clock: the source stops. The listener stays enabled for the next follow. */
    fun unfollow(): Map<String, Any?> {
        stopSource()
        return FollowAnswers.state(FollowAnswers.STOPPED)
    }

    /** The latest reading while following; access lost meanwhile ends following. */
    fun reading(): Map<String, Any?> {
        if (!following) return FollowAnswers.state(FollowAnswers.STOPPED)
        if (!access.granted()) {
            stopSource()
            return FollowAnswers.state(FollowAnswers.NO_ACCESS)
        }
        return FollowAnswers.reading(source.status(), source.latest(), clock())
    }

    /**
     * Play, pause or next, pressed by the instructor (issue #857): "sent" through the music app's own
     * session, "notSent" when it has none, "stopped" when not following. Access lost meanwhile ends
     * following, as for [reading], and nothing is sent.
     */
    fun command(command: TransportCommand): Map<String, Any?> {
        if (!following) return FollowAnswers.state(FollowAnswers.STOPPED)
        if (!access.granted()) {
            stopSource()
            return FollowAnswers.state(FollowAnswers.NO_ACCESS)
        }
        return FollowAnswers.state(if (source.command(command)) FollowAnswers.SENT else FollowAnswers.NOT_SENT)
    }

    /** The teardown on a mode switch, and at construction: nothing follows and the listener is disabled. */
    fun drop() {
        stopSource()
        access.enable(false)
    }

    private fun stopSource() {
        following = false
        source.stop()
    }

    private companion object {
        const val UNOPENED = "notOpened"
    }
}

/** Android's side of the listener: whether access is granted, the component's switch, the setting. */
interface ListenerAccess {
    fun granted(): Boolean

    /** Enables or disables the listener component; a disabled one is never bound by the system. */
    fun enable(on: Boolean)

    /** Opens the notification-access setting. False when the phone has no such screen. */
    fun openSetting(): Boolean
}
