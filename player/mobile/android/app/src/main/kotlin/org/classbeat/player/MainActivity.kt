package org.classbeat.player

import android.app.Activity
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.BridgeActivity
import org.classbeat.player.mode.AndroidDevice
import org.classbeat.player.mode.InstructorModePlugin
import org.classbeat.player.mode.ModeController
import org.classbeat.player.mode.ModeHolder
import org.classbeat.player.mode.ModeHost
import org.classbeat.player.mode.NO_PAIRING
import org.classbeat.player.mode.PrefsModeStore
import org.classbeat.player.mode.RiderModePlugin
import org.classbeat.player.mode.teardownParts

/**
 * The app's one activity: Capacitor's bridge with the bundled pages, locked down before its first
 * page commits. BridgeActivity.onCreate builds the bridge in load(), which also issues the first
 * page load; the lockdown runs right after, on the same main thread, so no script of the page runs
 * before it. Then the mode holder opens the last mode used and loads its start page (issue #630).
 */
class MainActivity : BridgeActivity(), ModeHost {
    private val lockPrompt = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        modes?.lockAnswered(it.resultCode == Activity.RESULT_OK)
    }

    override var modes: ModeController? = null
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super.onCreate: the bridge is built from these, and the lockdown takes both off it.
        registerPlugin(RiderModePlugin::class.java)
        registerPlugin(InstructorModePlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun load() {
        super.load()
        val controller = ModeController(this, lockPrompt)
        val locked = BridgeLockdown.apply(bridge, BuildConfig.DEBUG, controller)
        val webView = bridge.webView
        val holder = ModeHolder(PrefsModeStore(this), AndroidDevice(this, NO_PAIRING), controller, teardownParts { webView })
        modes = controller
        controller.start(holder, locked, webView)
    }

    override fun onResume() {
        super.onResume()
        modes?.resumed()
    }

    override fun onStop() {
        modes?.stopped()
        super.onStop()
    }
}
