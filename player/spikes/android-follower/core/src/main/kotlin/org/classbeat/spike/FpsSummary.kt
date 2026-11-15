package org.classbeat.spike

/** Turns a page's running frame count, sampled about once a second, into frames per second. */
class FrameCounter {
    private var lastFrames: Long? = null
    private var lastMs = 0L

    /** The first call only primes the counter (returns null); a count that went down (page reload) re-primes. */
    fun sample(frames: Long, nowMs: Long): Double? {
        val prev = lastFrames
        val dt = nowMs - lastMs
        lastFrames = frames
        lastMs = nowMs
        if (prev == null || frames < prev || dt <= 0) return null
        return (frames - prev) * 1000.0 / dt
    }
}

/**
 * The frame-rate result of one run. The scene's quality table steps down from Low to the plain 2D
 * screen when the rate stays under 30 fps for 5 s (scene.md), so [lowLevelHolds] is the run's pass.
 */
data class FpsSummary(
    val seconds: Int,
    val skippedWarmup: Int,
    val medianFps: Double?,
    val meanFps: Double?,
    val minFps: Double?,
    val maxFps: Double?,
    val secondsUnder30: Int,
    val longestRunUnder30: Int,
    val lowLevelHolds: Boolean,
) {
    fun asMap(): Map<String, Any?> = linkedMapOf(
        "seconds" to seconds, "skippedWarmup" to skippedWarmup, "medianFps" to medianFps?.let(::round1),
        "meanFps" to meanFps?.let(::round1), "minFps" to minFps?.let(::round1), "maxFps" to maxFps?.let(::round1),
        "secondsUnder30" to secondsUnder30, "longestRunUnder30" to longestRunUnder30, "lowLevelHolds" to lowLevelHolds,
    )
}

const val FALL_TO_PLAIN_FPS = 30.0
const val FALL_TO_PLAIN_SECONDS = 5

/** The first [warmupSeconds] samples (page load, shader compile) are left out of the figures. */
fun summarize(samples: List<Double>, warmupSeconds: Int = 2): FpsSummary {
    val used = samples.drop(warmupSeconds)
    if (used.isEmpty()) return FpsSummary(0, samples.size.coerceAtMost(warmupSeconds), null, null, null, null, 0, 0, false)
    val sorted = used.sorted()
    val mid = sorted.size / 2
    val median = if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2
    var run = 0
    var longest = 0
    for (f in used) {
        run = if (f < FALL_TO_PLAIN_FPS) run + 1 else 0
        longest = maxOf(longest, run)
    }
    return FpsSummary(
        seconds = used.size, skippedWarmup = samples.size - used.size, medianFps = median, meanFps = used.average(),
        minFps = sorted.first(), maxFps = sorted.last(), secondsUnder30 = used.count { it < FALL_TO_PLAIN_FPS },
        longestRunUnder30 = longest, lowLevelHolds = longest < FALL_TO_PLAIN_SECONDS,
    )
}
