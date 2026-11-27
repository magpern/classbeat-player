package org.classbeat.player.mode

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The pairing code stays out of Recents and screenshots (issue #952): the window flag is real, and
 * the pairing screen runs on it. [PairingUiTest] shows the screen turns it on and off.
 */
class PairingSecureWindowTest {
    private fun source(name: String) = File("src/main/kotlin/org/classbeat/player/mode/$name").readText()

    @Test
    fun `the secure flag sets and clears FLAG_SECURE on the window`() {
        val seams = source("PairingSeams.kt")
        val found = Regex("""class WindowSecureFlag\(private val window: Window\) : SecureFlag \{(.*?)\n\}""", RegexOption.DOT_MATCHES_ALL).find(seams)
        val body = found?.groupValues?.get(1) ?: error("no WindowSecureFlag")
        assertTrue(body.contains("WindowManager.LayoutParams.FLAG_SECURE"))
        assertTrue(body.contains("window.addFlags(flag)") && body.contains("window.clearFlags(flag)"))
    }

    @Test
    fun `the pairing screen is built on the activity's window flag`() {
        val controller = source("ModeController.kt")
        assertTrue(controller.contains("PairingUi(screens, parts.pairing, parts.ports, WindowSecureFlag(activity.window))"))
    }
}
