package org.classbeat.player.mode

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The presentation's web view is locked like the main one (issue #738). Android's classes cannot run
 * in a JVM test, so this reads the source: the page must have no native method to call, and the
 * settings must be the shared ones. ManifestTest holds the no-new-permission half.
 */
class RoomPresentationLockdownTest {
    private val source = File("src/main/kotlin/org/classbeat/player/mode/RoomPresentation.kt").readText()
        .lines().filterNot { it.trim().startsWith("//") || it.trim().startsWith("*") || it.trim().startsWith("/*") }
        .joinToString("\n")

    @Test
    fun `the presentation adds no script interface and builds no bridge`() {
        for (word in listOf("addJavascriptInterface", "Bridge(", "BridgeActivity", "getcapacitor", "evaluateJavascript", "postWebMessage", "addWebMessageListener", "WebViewCompat")) {
            assertEquals(word, false, word in source)
        }
    }

    @Test
    fun `the presentation uses the shared settings, the locked chrome client and the policy's loader rule`() {
        assertTrue("BridgeLockdown.harden(view.settings)" in source)
        assertTrue("LockedChromeClient()" in source)
        assertTrue("ExternalDisplayPolicy.mayLoad(" in source)
        assertEquals(false, "blockNetworkLoads = false" in source || "allowFileAccess = true" in source || "allowContentAccess = true" in source)
    }

    @Test
    fun `the shared settings keep the network blocked`() {
        val lockdown = File("src/main/kotlin/org/classbeat/player/BridgeLockdown.kt").readText()
        val body = lockdown.substringAfter("fun harden(s: WebSettings)").substringBefore("\n    }\n")
        assertTrue("s.blockNetworkLoads = true" in body)
        assertTrue("s.allowFileAccess = false" in body)
    }
}
