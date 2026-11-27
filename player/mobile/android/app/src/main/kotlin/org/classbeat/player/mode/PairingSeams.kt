package org.classbeat.player.mode

import android.os.Handler
import android.os.Looper
import android.view.Window
import android.view.WindowManager

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

/** Keeps the window out of Recents and screenshots while the pairing screen shows its code. */
interface SecureFlag {
    fun secure(on: Boolean)
}

/** [SecureFlag] on the activity's window: FLAG_SECURE blanks the Recents thumbnail and blocks screenshots. */
class WindowSecureFlag(private val window: Window) : SecureFlag {
    override fun secure(on: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_SECURE
        if (on) window.addFlags(flag) else window.clearFlags(flag)
    }
}
