package org.classbeat.player.mode

import android.view.Window
import android.view.WindowManager
import org.classbeat.player.policy.KeepAwakePolicy
import org.classbeat.player.policy.Mode

/** The window's keep-screen-on flag, as [KeepAwake] needs it. The Android edge implements it with the real window. */
interface ScreenFlag {
    /** Sets the flag when [on], clears it otherwise. */
    fun keepOn(on: Boolean)
}

/** [ScreenFlag] on an activity's window: FLAG_KEEP_SCREEN_ON. Main thread only. */
class WindowScreenFlag(private val window: Window) : ScreenFlag {
    override fun keepOn(on: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (on) window.addFlags(flag) else window.clearFlags(flag)
    }
}

/** Carries out [KeepAwakePolicy]'s decision on the window flag (issue #737). It decides nothing itself. */
class KeepAwake(private val flag: ScreenFlag) {
    /** The flag follows the policy for these inputs. */
    fun sync(mode: Mode?, page: String?, riderJoined: Boolean, foreground: Boolean) =
        flag.keepOn(KeepAwakePolicy.keepOn(mode, page, riderJoined, foreground))

    /** The flag is cleared at once, whatever the policy would say (between modes). */
    fun release() = flag.keepOn(false)
}
