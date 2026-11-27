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
import org.classbeat.player.classes.InstructorIntents
import org.classbeat.player.follow.Follower
import org.classbeat.player.pairing.PairingPorts
import org.classbeat.player.pairing.PairingService
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
) : ModeEffects, PageGate, PageSteps, UnpairSteps {
    private lateinit var holder: ModeHolder
    private lateinit var locked: BridgeLockdown.Locked
    private lateinit var webView: WebView
    private val screens = ModeScreens(activity)
    private val keepAwake = KeepAwake(WindowScreenFlag(activity.window))
    private val opener = PageOpener(this)
    private val externalDisplay = ExternalDisplay(AndroidDisplays(activity), AndroidRoomSurface(activity))
    private lateinit var pairing: PairingUi

    /** Instructor mode's class intents. */
    lateinit var instructor: InstructorBridge
        private set

    /** Rider mode's live intents (#633). */
    lateinit var rider: RiderBridge
        private set

    /** Instructor mode's follow intents (issue #632). */
    lateinit var follow: FollowBridge
        private set

    /** The page call the open question answers: one at a time, a second is refused (#673). */
    private val question = PageQuestion<PluginCall>({ call, answer -> call.resolve(result(answer)) }, { it.reject(REFUSED) })

    /** The "Unpair this phone?" question. */
    private val unpairing = UnpairQuestion(this)

    private lateinit var intents: InstructorIntents

    /** The main-frame page last committed, and whether the app is in the foreground: inputs of [KeepAwake]. */
    private var page: String? = null
    private var foreground = false

    /** Back while a native screen shows answers it as "Stay", never as the page's Back. */
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = stay()
    }

    fun start(holder: ModeHolder, locked: BridgeLockdown.Locked, webView: WebView, parts: InstructorParts, rider: RiderBridge) {
        this.holder = holder
        this.locked = locked
        this.webView = webView
        pairing = PairingUi(screens, parts.pairing, parts.ports, WindowSecureFlag(activity.window)) { holder.secureLock }
        parts.pairing.changed = pairing::changed
        instructor = InstructorBridge(parts.intents) { current }
        follow = FollowBridge(parts.follower, parts.pairing::secrets) { current }
        intents = parts.intents
        this.rider = rider
        rider.joinedChanged = ::syncKeepAwake
        // Added first, so a native screen's Back (added last) runs before the rider's.
        activity.onBackPressedDispatcher.addCallback(activity, rider.back)
        activity.onBackPressedDispatcher.addCallback(activity, back)
        externalDisplay.start()
        holder.start()
    }

    val current: Mode? get() = if (::holder.isInitialized) holder.current else null

    // PageGate: the web view client asks before any page loads or commits.

    override fun mayShow(path: String): Boolean = opener.mayShow(path) ?: ModePolicy.mayShow(current, path)

    override fun shown(path: String) {
        page = path
        opener.committed(path)
        syncKeepAwake()
        syncExternalDisplay()
    }

    // PageSteps: the opener's steps.

    override fun expose(mode: Mode?) = PluginPolicy.expose(locked.table, locked.kept, mode?.plugin)

    override fun load(path: String) = webView.loadUrl(NavigationPolicy.APP_ORIGIN + path)

    override fun ready() {
        webView.clearHistory()
        // A pair again's save-failed plate shows over rider mode (issue #952); any other screen goes.
        if (pairing.pageReady()) back.isEnabled = true else hideScreen()
    }

    // ModeEffects.

    override fun closeBridge() {
        expose(null)
        // Between modes: the screen is released at once, before the drops run.
        page = null
        keepAwake.release()
        syncExternalDisplay()
        pairing.drop()
        unpairing.close()
        // The page that asked is being replaced: its question ends here, with the one refused word.
        question.drop()
    }

    /** Through the blank page: the mode's plugin goes on only once the last page is gone (PageOpener). */
    override fun open(mode: Mode) = opener.open(mode)

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

    // Every question goes through [question]: while one is open, any other ask is refused and the
    // open one keeps its call, so a rider-mode ask can no longer take the unpair call's place.

    fun askInstructorMode(call: PluginCall) = question.ask(call) {
        if (pairing.showing) return@ask false
        when (holder.askInstructor()) {
            null -> false
            // N3: on an unpaired phone the strip's key starts pairing, on the native pairing screen.
            ModePolicy.Entry.PAIR -> true.also { showScreen { pairing.open(instructor = false, leave = ::pairingLeft) } }
            ModePolicy.Entry.NO_LOCK, ModePolicy.Entry.ASK_LOCK -> true
        }
    }

    /** Instructor mode's "Pair again" (the pairing expired): the same native screen. */
    fun pairAgain(call: PluginCall) = question.ask(call) {
        if (pairing.showing) return@ask false
        true.also { showScreen { pairing.open(instructor = true, leave = ::pairingLeft) } }
    }

    /** Instructor mode's "Unpair this phone": asks first; only "Unpair" deletes anything. */
    fun unpair(call: PluginCall) = question.ask(call) {
        if (pairing.showing || holder.pending != null || current != Mode.INSTRUCTOR) return@ask false
        true.also { unpairing.ask() }
    }

    fun askRiderMode(call: PluginCall) = question.ask(call) { holder.askRider() }

    // From the activity.

    /** The system screen-lock prompt answered. */
    fun lockAnswered(passed: Boolean) {
        if (holder.lockAnswered(passed)) return
        hideScreen()
        settle("notConfirmed")
    }

    /** Back in the app, from the security settings or anywhere else: the lock may have been set meanwhile. */
    fun resumed() {
        foreground = true
        syncKeepAwake()
        syncExternalDisplay()
        pairing.resumed()
        if (holder.pending != ModeHolder.Pending.NO_LOCK) return
        holder.noLockReturned()
        // No longer paired: nothing to ask, so the screen goes and the page hears so.
        if (holder.pending == null) {
            hideScreen()
            settle("unpaired")
        }
    }

    /** Leaving the app while the question shows means "Stay". */
    fun stopped() {
        foreground = false
        syncKeepAwake()
        syncExternalDisplay()
        if (holder.pending == ModeHolder.Pending.RIDER_QUESTION || unpairing.showing) stay()
    }

    private fun openSettings() {
        activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
    }

    /** The pairing screen went. In rider mode a pairing made goes on to the screen lock, as the key now would. */
    private fun pairingLeft(made: Boolean) {
        back.isEnabled = false
        if (!made || current != Mode.RIDER) return settle(if (made) "paired" else "stayed")
        when (holder.askInstructor()) {
            ModePolicy.Entry.NO_LOCK, ModePolicy.Entry.ASK_LOCK -> Unit
            else -> settle("stayed")
        }
    }

    // UnpairSteps: the unpair question's steps. "Unpair": the page hears first, then the token and
    // the classes go and instructor mode closes.

    override fun showQuestion(stay: () -> Unit, unpair: () -> Unit) = showScreen { screens.unpairQuestion(stay, unpair) }

    override fun answer(result: String) {
        hideScreen()
        settle(result)
    }

    override fun unpair() = intents.unpair()

    override fun stay() {
        // Between modes (the switching screen): Back does nothing, and the screen stays.
        if (current == null) return
        if (pairing.showing) return pairing.back()
        unpairing.close()
        when (holder.pending) {
            ModeHolder.Pending.NO_LOCK -> holder.noLockStay()
            ModeHolder.Pending.RIDER_QUESTION -> holder.riderAnswered(false)
            else -> Unit
        }
        hideScreen()
        settle("stayed")
    }

    /** The window flag follows the pure decision; it is set only on the main thread, as everything here. */
    private fun syncKeepAwake() =
        keepAwake.sync(current, page, riderJoined(), foreground)

    /** The room screen on an external display follows the pure decision, as the window flag does (issue #738). */
    private fun syncExternalDisplay() = externalDisplay.update(current, page, foreground)

    /** The activity is going: the room screen comes down and the displays are no longer watched. */
    fun destroyed() = externalDisplay.stop()

    private fun riderJoined() = ::rider.isInitialized && rider.joined

    private fun settle(answer: String) = question.settle(answer)

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

/** What instructor mode and the pairing screen run on, built by the activity. */
class InstructorParts(val pairing: PairingService, val ports: PairingPorts, val intents: InstructorIntents, val follower: Follower)
