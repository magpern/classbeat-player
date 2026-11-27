package org.classbeat.player.mode

import android.os.Handler
import android.os.Looper

/** What the pairing screen draws on: [ModeScreens] on the phone, a fake in a JVM test. */
interface PairingScreens {
    fun screen(lead: List<ScreenLine>, act: List<ScreenLine>, keys: List<ModeScreens.Key>)

    /** Changes the words in place; false when the screen must be shown anew. */
    fun retext(lines: List<ScreenLine>): Boolean

    fun hide()
}

/** The pairing screen's countdown timer, on the main thread. */
interface Ticker {
    fun after(ms: Long, run: Runnable)

    fun cancel(run: Runnable)
}

/** [Ticker] on the main looper. */
class MainTicker : Ticker {
    private val handler = Handler(Looper.getMainLooper())

    override fun after(ms: Long, run: Runnable) {
        handler.postDelayed(run, ms)
    }

    override fun cancel(run: Runnable) = handler.removeCallbacks(run)
}
