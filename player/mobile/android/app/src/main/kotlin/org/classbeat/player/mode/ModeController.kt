package org.classbeat.player.mode

import android.app.KeyguardManager
import android.content.Intent
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.classbeat.player.BridgeLockdown
import org.classbeat.player.PageGate
import org.classbeat.player.policy.Mode
import org.classbeat.player.policy.ModePolicy
import org.classbeat.player.policy.NavigationPolicy
import org.classbeat.player.policy.PluginPolicy

/**
 * The Android edge of the mode holder (issue #630): it puts the current mode's plugin on the bridge,
 * loads the mode's pages and no other, shows the native screens and asks for the screen lock. The
 * holder decides; this only carries it out. Every method runs on the main thread.
 */
class ModeController(
    private val activity: ComponentActivity,
    private val lockPrompt: ActivityResultLauncher<Intent>,
) : ModeEffects, PageGate {
    private lateinit var holder: ModeHolder
    private lateinit var locked: BridgeLockdown.Locked
    private lateinit var webView: WebView
    private val screens = ModeScreens(activity)

    /** The page's askInstructorMode or askRiderMode call, answered when the question it opened is. */
    private var waiting: PluginCall? = null

    /** The next page to commit is a mode's start page: its history starts there. */
    private var fresh = false

    /** Android's security settings were opened from the no-lock screen. */
    private var inSettings = false

    /** Back while a native screen shows answers it as "Stay", never as the page's Back. */
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = stay()
    }

    fun start(holder: ModeHolder, locked: BridgeLockdown.Locked, webView: WebView) {
        this.holder = holder
        this.locked = locked
        this.webView = webView
        activity.onBackPressedDispatcher.addCallback(activity, back)
        holder.start()
    }

    val current: Mode? get() = if (::holder.isInitialized) holder.current else null

    // PageGate: the web view client asks before any page loads or commits.

    override fun mayShow(path: String): Boolean = ModePolicy.mayShow(current, path)

    override fun shown(view: WebView) {
        if (!fresh) return
        fresh = false
        view.clearHistory()
        hideScreen()
    }

    // ModeEffects.

    override fun closeBridge() = PluginPolicy.expose(locked.table, locked.kept, null)

    override fun open(mode: Mode) {
        waiting = null
        PluginPolicy.expose(locked.table, locked.kept, mode.plugin)
        fresh = true
        webView.loadUrl(NavigationPolicy.APP_ORIGIN + ModePolicy.startPage(mode))
    }

    override fun askLock() {
        val keyguard = activity.getSystemService(KeyguardManager::class.java)
        // Null means the device has no secure lock after all: the holder treats it as not passed.
        @Suppress("DEPRECATION")
        val intent = keyguard?.createConfirmDeviceCredentialIntent("Instructor mode", "Confirm your screen lock to open instructor mode.")
        if (intent == null) lockAnswered(false) else lockPrompt.launch(intent)
    }

    override fun showNoLock() = showScreen { screens.noLock(setLock = ::openSettings, stay = ::stay) }

    override fun askRiderQuestion() = showScreen { screens.riderQuestion(stay = ::stay, switch = { holder.riderAnswered(true) }) }

    override fun showSwitching(mode: Mode) = showScreen { screens.switching(rider = mode == Mode.RIDER) }

    /** A part could not be dropped: the app stops here rather than open a page with it left. */
    override fun fatal(failed: List<String>) = throw IllegalStateException("The mode switch could not drop: $failed")

    // From the page, through the mode plugins (already checked by IntentPolicy).

    fun instructorWay(call: PluginCall) =
        call.resolve(JSObject().put("way", if (holder.paired) "lock" else "pair"))

    fun askInstructorMode(call: PluginCall) {
        when (holder.askInstructor()) {
            null -> call.reject(REFUSED)
            ModePolicy.Entry.PAIR -> call.resolve(result("unpaired"))
            ModePolicy.Entry.NO_LOCK, ModePolicy.Entry.ASK_LOCK -> waiting = call
        }
    }

    fun askRiderMode(call: PluginCall) {
        if (holder.askRider()) waiting = call else call.reject(REFUSED)
    }

    // From the activity.

    /** The system screen-lock prompt answered. */
    fun lockAnswered(passed: Boolean) {
        if (holder.lockAnswered(passed)) return
        hideScreen()
        settle("notConfirmed")
    }

    fun resumed() {
        if (!inSettings) return
        inSettings = false
        holder.noLockReturned()
        // No longer paired: nothing to ask, so the screen goes and the page hears so.
        if (holder.pending == null) {
            hideScreen()
            settle("unpaired")
        }
    }

    /** Leaving the app while the question shows means "Stay". */
    fun stopped() {
        if (holder.pending == ModeHolder.Pending.RIDER_QUESTION) stay()
    }

    private fun openSettings() {
        inSettings = true
        activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
    }

    private fun stay() {
        when (holder.pending) {
            ModeHolder.Pending.NO_LOCK -> holder.noLockStay()
            ModeHolder.Pending.RIDER_QUESTION -> holder.riderAnswered(false)
            else -> Unit
        }
        hideScreen()
        settle("stayed")
    }

    private fun settle(answer: String) {
        waiting?.resolve(result(answer))
        waiting = null
    }

    private fun showScreen(show: () -> Unit) {
        show()
        back.isEnabled = true
    }

    private fun hideScreen() {
        screens.hide()
        back.isEnabled = false
    }

    private fun result(answer: String) = JSObject().put("result", answer)

    private companion object {
        /** The only word the page gets for a refused call. */
        const val REFUSED = "refused"
    }
}
