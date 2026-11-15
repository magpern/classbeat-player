package org.classbeat.spike

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FpsSummaryTest {
    @Test
    fun counterGivesFramesPerSecondFromTheElapsedTime() {
        val c = FrameCounter()
        assertNull(c.sample(100, 1_000))
        assertEquals(60.0, c.sample(160, 2_000)!!, 1e-9)
        assertEquals(30.0, c.sample(175, 2_500)!!, 1e-9)
    }

    @Test
    fun counterReprimesWhenTheCountGoesDownOrTimeStandsStill() {
        val c = FrameCounter()
        c.sample(500, 1_000)
        assertNull(c.sample(10, 2_000))
        assertEquals(50.0, c.sample(60, 3_000)!!, 1e-9)
        assertNull(c.sample(70, 3_000))
    }

    @Test
    fun summaryDropsTheWarmupAndReportsMedianMinAndMean() {
        val s = summarize(listOf(5.0, 5.0, 60.0, 58.0, 59.0, 57.0))
        assertEquals(4, s.seconds)
        assertEquals(2, s.skippedWarmup)
        assertEquals(58.5, s.medianFps!!, 1e-9)
        assertEquals(57.0, s.minFps!!, 1e-9)
        assertEquals(60.0, s.maxFps!!, 1e-9)
        assertEquals(58.5, s.meanFps!!, 1e-9)
        assertEquals(0, s.secondsUnder30)
        assertTrue(s.lowLevelHolds)
    }

    @Test
    fun oddCountMedianIsTheMiddleSample() {
        assertEquals(40.0, summarize(listOf(30.0, 40.0, 50.0), warmupSeconds = 0).medianFps!!, 1e-9)
    }

    @Test
    fun fiveSecondsUnder30IsTheStepDownToPlain() {
        val four = summarize(List(2) { 60.0 } + List(4) { 20.0 } + listOf(60.0, 20.0, 20.0))
        assertEquals(4, four.longestRunUnder30)
        assertEquals(6, four.secondsUnder30)
        assertTrue(four.lowLevelHolds)
        val five = summarize(List(2) { 60.0 } + List(5) { 29.9 } + listOf(60.0))
        assertEquals(5, five.longestRunUnder30)
        assertFalse(five.lowLevelHolds)
        assertTrue(summarize(List(8) { 30.0 }, 0).lowLevelHolds)
    }

    @Test
    fun tooFewSamplesGiveNoVerdict() {
        val s = summarize(listOf(60.0, 60.0))
        assertEquals(0, s.seconds)
        assertNull(s.medianFps)
        assertFalse(s.lowLevelHolds)
    }

    @Test
    fun summaryLineRoundsAndKeepsNulls() {
        val line = fpsSummaryLine(Stamp(1, 2), summarize(listOf(1.0, 1.0, 58.04, 59.96, 60.0)))
        assertEquals(
            """{"t":"fps_summary","monoMs":1,"wallMs":2,"seconds":3,"skippedWarmup":2,"medianFps":60.0,"meanFps":59.3,"minFps":58.0,"maxFps":60.0,"secondsUnder30":0,"longestRunUnder30":0,"lowLevelHolds":true}""",
            line,
        )
    }
}
