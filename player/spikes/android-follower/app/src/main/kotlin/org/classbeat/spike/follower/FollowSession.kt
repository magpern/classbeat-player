package org.classbeat.spike.follower

import android.content.Context
import android.os.Build
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.classbeat.spike.Stamp
import org.classbeat.spike.controlLine
import org.classbeat.spike.markerLine
import org.classbeat.spike.metaLine
import org.classbeat.spike.readerErrorLine
import org.classbeat.spike.readingLine

const val POLLS_PER_SECOND = 4

/**
 * Polls Spotify's media session and writes spike 1's log lines. Everything runs on one thread, so
 * the file is written in order. The class clock is not run here: the replay runs it afterwards.
 */
class FollowSession(
    context: Context,
    private val onStatus: (String) -> Unit,
) {
    private val reader = SpotifyReader(context)
    private val log = LogFile(context, "follow")
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var lastProblem: String? = null
    private var lastShown = ""

    val fileName: String get() = log.file.name

    private fun stamp(monoMs: Long = SystemClock.elapsedRealtime()) = Stamp(monoMs, System.currentTimeMillis())

    fun start() {
        executor.execute {
            log.write(
                metaLine(
                    stamp(),
                    linkedMapOf(
                        "event" to "start", "platform" to "android", "source" to "android-media-session",
                        "rate" to POLLS_PER_SECOND, "limitations" to listOf<String>(),
                        "device" to "${Build.MANUFACTURER} ${Build.MODEL}", "androidSdk" to Build.VERSION.SDK_INT,
                    ),
                ),
            )
        }
        executor.scheduleWithFixedDelay(::pollOnce, 0, (1000 / POLLS_PER_SECOND).toLong(), TimeUnit.MILLISECONDS)
    }

    private fun pollOnce() {
        // An exception would silently end a scheduled task: log it and keep polling.
        val poll = try {
            reader.poll()
        } catch (e: RuntimeException) {
            Poll(SystemClock.elapsedRealtime(), null, "reader failed: ${e.javaClass.simpleName}: ${e.message}")
        }
        val s = stamp(poll.polledAtMs)
        if (poll.problem != null && poll.problem != lastProblem) log.write(readerErrorLine(s, poll.problem))
        lastProblem = poll.problem
        log.write(readingLine(s, poll.reading))
        val text = describe(poll)
        if (text != lastShown) {
            lastShown = text
            onStatus(text)
        }
    }

    private fun describe(poll: Poll): String {
        val r = poll.reading
        return when {
            r != null -> "${r.state.json}: ${r.title} (${r.artist}), at ${r.positionMs / 1000} s"
            poll.problem != null -> "No reading: ${poll.problem}"
            else -> "No Spotify session (start Spotify and play)"
        }
    }

    /** `b` beat tap or `m` mark. */
    fun marker(key: String) = executor.execute { log.write(markerLine(stamp(), key)) }

    /** `undo` or `relink`, applied by the replay. */
    fun control(key: String) = executor.execute { log.write(controlLine(stamp(), key)) }

    fun stop() {
        executor.execute {
            log.write(metaLine(stamp(), linkedMapOf("event" to "end")))
            log.close()
        }
        executor.shutdown()
    }
}
