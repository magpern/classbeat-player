package org.classbeat.player.policy

import org.classbeat.player.policy.NavigationPolicy.Decision.BROWSER
import org.classbeat.player.policy.NavigationPolicy.Decision.LOAD
import org.classbeat.player.policy.NavigationPolicy.Decision.REFUSE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    private val bundled = listOf(
        "https://localhost/",
        "https://localhost",
        "https://localhost/index.html",
        "https://localhost/main.js",
        "https://localhost/fonts/a.woff2",
        "https://localhost/index.html?x=1#top",
    )

    private val notBundled = listOf(
        "http://localhost/",
        "https://localhost:8443/",
        "https://user@localhost/",
        "https://localhost.example.com/",
        "https://example.com/",
        "https://LOCALHOST.evil/",
        "https://localhost/_capacitor_file_/data/data/x",
        "https://localhost/_capacitor_content_/x",
        "https://localhost/_capacitor_http_interceptor_?u=https://example.com",
        "https://localhost/a/../_capacitor_file_/x",
        "https://localhost/%2e%2e/x",
        "file:///android_asset/public/index.html",
        "content://org.classbeat.player/x",
        "data:text/html,<p>x",
        "blob:https://localhost/1234",
        "javascript:alert(1)",
        "about:blank",
        "intent://x#Intent;scheme=https;end",
        "ws://localhost/",
        "not a url",
        "",
    )

    @Test
    fun `only the bundle is served`() {
        for (u in bundled) assertTrue(u, NavigationPolicy.serves(u))
        for (u in notBundled) assertFalse(u, NavigationPolicy.serves(u))
    }

    @Test
    fun `the bundle loads in the main frame only`() {
        for (u in bundled) {
            assertEquals(u, LOAD, NavigationPolicy.navigate(u, mainFrame = true, userGesture = false))
            assertEquals(u, REFUSE, NavigationPolicy.navigate(u, mainFrame = false, userGesture = true))
        }
    }

    @Test
    fun `a tapped https link to a site opens in the browser`() {
        for (u in listOf("https://example.com/", "https://classbeat.example/help?a=1")) {
            assertEquals(u, BROWSER, NavigationPolicy.navigate(u, mainFrame = true, userGesture = true))
        }
    }

    @Test
    fun `without a tap, in a frame, or of another kind, a link is refused`() {
        val site = "https://example.com/"
        assertEquals(REFUSE, NavigationPolicy.navigate(site, mainFrame = true, userGesture = false))
        assertEquals(REFUSE, NavigationPolicy.navigate(site, mainFrame = false, userGesture = true))
        val others = notBundled - setOf("https://example.com/", "https://localhost.example.com/", "https://LOCALHOST.evil/")
        for (u in others) {
            assertEquals(u, REFUSE, NavigationPolicy.navigate(u, mainFrame = true, userGesture = true))
        }
        assertEquals(REFUSE, NavigationPolicy.navigate("https://user:pw@example.com/", mainFrame = true, userGesture = true))
    }
}
