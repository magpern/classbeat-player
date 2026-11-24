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
        "https://localhost/fonts/a%20b.woff2",
        "https://localhost/fonts/",
        "https://localhost/my_capacitor_notes.js",
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
        // Capacitor's server decodes the path before it matches its prefixes (review of #637).
        "https://localhost/%5Fcapacitor_file_/data/data/org.classbeat.player/x",
        "https://localhost/%5fcapacitor_file_/x",
        "https://localhost/_%63apacitor_content_/x",
        "https://localhost/%5F%63%61%70%61%63%69%74%6F%72_http_interceptor_",
        "https://localhost/%255Fcapacitor_file_/x",
        "https://localhost/%25%35%46capacitor_file_/x",
        "https://localhost/_CAPACITOR_FILE_/x",
        "https://localhost/_Capacitor_file_/x",
        "https://localhost/fonts/_capacitor_file_/x",
        "https://localhost//_capacitor_file_/x",
        "https://localhost/fonts//a.woff2",
        "https://localhost/a/../index.html",
        "https://localhost/./index.html",
        "https://localhost/a/%2E%2E/_capacitor_file_/x",
        "https://localhost/a/.%2e/x",
        "https://localhost/a%2f..%2f_capacitor_file_/x",
        "https://localhost/a%5c..%5c_capacitor_file_/x",
        "https://localhost/a%00.html",
        "https://localhost/%C0%AF",
        "https://localhost/%FF",
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
    fun `the path is decoded strictly, and a bad escape fails closed`() {
        assertEquals("/_capacitor_file_/x", NavigationPolicy.decodePath("/%5Fcapacitor_file_/x"))
        assertEquals("/%5F", NavigationPolicy.decodePath("/%255F"))
        assertEquals("/a b/é", NavigationPolicy.decodePath("/a%20b/%C3%A9"))
        for (bad in listOf("/%", "/%5", "/%zz", "/%5G", "/%C0%AF", "/%FF", "/%C3")) {
            assertEquals(bad, null, NavigationPolicy.decodePath(bad))
        }
    }

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
