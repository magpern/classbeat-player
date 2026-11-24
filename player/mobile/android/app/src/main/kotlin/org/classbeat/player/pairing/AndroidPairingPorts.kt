package org.classbeat.player.pairing

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.classbeat.player.classes.ClassCache

/**
 * The pairing's ports on Android. Time is the monotonic clock, so a clock change on the phone
 * moves neither the poll nor the code's countdown. The pair page opens in the browser through
 * Android, never in the app's web view, which never loads a page that is not the app's own.
 */
class AndroidPairingPorts(private val activity: Activity, private val cache: ClassCache) : PairingPorts {
    private val handler = Handler(Looper.getMainLooper())

    override fun now(): Long = SystemClock.elapsedRealtime()

    override fun at(time: Long, run: () -> Unit) {
        handler.postDelayed({ run() }, (time - now()).coerceAtLeast(0))
    }

    override fun openPage(page: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(page)).addCategory(Intent.CATEGORY_BROWSABLE)
        return try {
            activity.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        } catch (e: SecurityException) {
            false
        }
    }

    override fun forgetCache() {
        try {
            cache.clear()
        } catch (e: Exception) {
            // Only instructor mode reads the cache, and it closes as the pairing goes; the next
            // sync with a new pairing replaces or removes what is left.
        }
    }
}
