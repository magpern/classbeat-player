package org.classbeat.player

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.BridgeActivity
import org.classbeat.player.backend.OfflineTransport
import org.classbeat.player.classes.ClassSync
import org.classbeat.player.classes.FileClassCache
import org.classbeat.player.classes.InstructorIntents
import org.classbeat.player.mode.AndroidDevice
import org.classbeat.player.mode.InstructorModePlugin
import org.classbeat.player.mode.InstructorParts
import org.classbeat.player.mode.ModeController
import org.classbeat.player.mode.ModeHolder
import org.classbeat.player.mode.ModeHost
import org.classbeat.player.mode.Pairing
import org.classbeat.player.mode.PrefsModeStore
import org.classbeat.player.mode.RiderModePlugin
import org.classbeat.player.mode.teardownParts
import org.classbeat.player.pairing.AndroidPairingPorts
import org.classbeat.player.pairing.KeystoreSecretStore
import org.classbeat.player.pairing.PairingService
import org.classbeat.player.policy.OriginPolicy

/**
 * The app's one activity: Capacitor's bridge with the bundled pages, locked down before its first
 * page commits. BridgeActivity.onCreate builds the bridge in load(), which also issues the first
 * page load; the lockdown runs right after, on the same main thread, so no script of the page runs
 * before it. Then the pairing is read from the Keystore (issue #631) and the mode holder opens the
 * last mode used and loads its start page (issue #630).
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
        // The backend fixed in the build: HTTPS, or loopback in a debug build (ADR 0011 §3). The
        // real transport waits on the owner (#649, #650): until then every call is "offline".
        val origin = OriginPolicy.parseBackendOrigin(BuildConfig.BACKEND_ORIGIN, BuildConfig.DEBUG)
        val transport = OfflineTransport { Handler(Looper.getMainLooper()).post(it) }
        // noBackupFilesDir: the classes stay out of backups, as the pairing does.
        val cache = FileClassCache(noBackupFilesDir)
        val ports = AndroidPairingPorts(this, cache)
        val pairing = PairingService(origin, BuildConfig.DEBUG, BuildConfig.VERSION_NAME, transport, KeystoreSecretStore(this), ports)
        val intents = InstructorIntents(pairing, cache, ClassSync(transport, cache, pairing::credential, pairing::refused))
        val holder = ModeHolder(PrefsModeStore(this), AndroidDevice(this, Pairing { pairing.paired() }), controller, teardownParts { webView })
        // The token was deleted (unpaired, revoked or unknown): instructor mode closes at once.
        pairing.forgotten = holder::unpaired
        pairing.load()
        modes = controller
        controller.start(holder, locked, webView, InstructorParts(pairing, ports, intents))
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
