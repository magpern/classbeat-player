package org.classbeat.player.mode

import android.app.KeyguardManager
import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewFeature
import org.classbeat.player.follow.Follower

/**
 * The last mode used, in the app's private preferences (MODE_PRIVATE): native storage the web
 * view cannot reach, and left out of backups (allowBackup is false in the manifest).
 */
class PrefsModeStore(context: Context) : ModeStore {
    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun read(): String? = prefs.getString(KEY, null)

    override fun write(value: String) {
        // commit, not apply: the switch goes on only once the mode is on disk.
        check(prefs.edit().putString(KEY, value).commit()) { "the mode was not written" }
    }

    override fun wipePending(): Boolean = prefs.getBoolean(WIPE, false)

    override fun setWipePending(pending: Boolean) {
        check(prefs.edit().putBoolean(WIPE, pending).commit()) { "the wipe flag was not written" }
    }

    private companion object {
        const val FILE = "mode"
        const val KEY = "last"
        const val WIPE = "wipe_pending"
    }
}

/** Whether this device is paired with an instructor's account (ADR 0011 section 5): PairingService.paired. */
fun interface Pairing {
    fun paired(): Boolean
}

/**
 * The device as the holder sees it. The screen lock is Android's own answer each time it is
 * asked: a PIN, pattern or password set (KeyguardManager.isDeviceSecure), never a cached value.
 */
class AndroidDevice(context: Context, private val pairing: Pairing) : Device {
    private val keyguard = context.getSystemService(KeyguardManager::class.java)

    override val paired: Boolean get() = pairing.paired()

    override val secureLock: Boolean get() = keyguard?.isDeviceSecure == true
}

/**
 * Everything a switch drops (ModePolicy.TEARDOWN, in its order). The follower (#632) stops its
 * source and disables the notification listener. The instructor's connections and the rider's
 * session and numbers do not exist yet; the issues that add them (#631, #633) put their drop here. The web view's storage exists now: local and
 * session storage, IndexedDB, cookies, the cache and the history all go, so the next page starts
 * with nothing the last mode's page left. Android wipes storage and cookies in the background, so
 * the drop is done only when both say they have finished (Join); the next page waits for it.
 */
fun teardownParts(follower: Follower, webView: () -> WebView): List<Teardown> = listOf(
    now("follower") { follower.drop() },
    now("connections") {},
    now("instructorState") {},
    now("riderSession") {},
    now("riderNumbers") {},
    Teardown("webStorage") { done ->
        val view = webView()
        view.stopLoading()
        view.clearCache(true)
        view.clearFormData()
        view.clearHistory()
        val wipe = Join(done)
        wipeStorage(wipe.part())
        val cookies = wipe.part()
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            cookies(null)
        }
        wipe.started()
    },
)

/** A drop that is over when it returns. */
private fun now(name: String, drop: () -> Unit) = Teardown(name) { done -> drop(); done(null) }

/**
 * Local and session storage, IndexedDB and the rest of the web view's site data, answering once the
 * wipe has finished. Where the web view cannot say so (DELETE_BROWSING_DATA missing), the older
 * wipe runs and the stored origins are read back after it: any left means the wipe failed.
 */
private fun wipeStorage(done: (Throwable?) -> Unit) {
    val storage = WebStorage.getInstance()
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
        WebStorageCompat.deleteBrowsingData(storage) { done(null) }
        return
    }
    storage.deleteAllData()
    storage.getOrigins { origins ->
        done(if (origins.isNullOrEmpty()) null else IllegalStateException("web storage was left"))
    }
}
