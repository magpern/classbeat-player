package org.classbeat.player

import android.annotation.SuppressLint
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.plugin.CapacitorCookieManager
import java.net.CookieHandler
import org.apache.cordova.CordovaWebView
import org.classbeat.player.policy.PluginPolicy

/**
 * Locks a freshly built Capacitor bridge (issue #627). Every step fails closed: anything the shell
 * does not recognise stops the app rather than run with it.
 *
 * - Every plugin is removed from the bridge's table and from its Cordova plugin manager
 *   (PluginPolicy), so the page can call none.
 * - The two script interfaces Capacitor's cookie and HTTP plugins added are removed, and the
 *   cookie plugin's process-wide cookie handler is taken back.
 * - Capacitor's web view and chrome clients are replaced with locked ones: the bundle only, no
 *   permission ever granted, links out to the system browser.
 * - Web view settings: no file or content access, no geolocation, no windows, no mixed content,
 *   no network loads; service workers get nothing; remote debugging only in a debug build.
 * - Then the first page is loaded again, so it commits with all of the above in place.
 */
object BridgeLockdown {
    /** The interfaces CapacitorCookies and CapacitorHttp add when they load; `androidBridge` stays (it carries no plugin now). */
    val REMOVED_INTERFACES: List<String> = listOf("CapacitorCookiesAndroidInterface", "CapacitorHttpAndroidInterface")

    fun apply(bridge: Bridge, debug: Boolean) {
        checkConfig(bridge)
        removePlugins(bridge)
        removeCordovaPlugins(bridge)
        val webView = bridge.webView
        REMOVED_INTERFACES.forEach(webView::removeJavascriptInterface)
        if (CookieHandler.getDefault() is CapacitorCookieManager) CookieHandler.setDefault(null)
        harden(webView.settings)
        lockServiceWorkers()
        WebView.setWebContentsDebuggingEnabled(debug)
        bridge.setWebViewClient(LockedWebViewClient(bridge, webView.context))
        webView.webChromeClient = LockedChromeClient()
        webView.stopLoading()
        webView.loadUrl(bridge.appUrl)
    }

    private fun checkConfig(bridge: Bridge) {
        val config = bridge.config
        check(config.serverUrl == null) { "server.url is set" }
        check(config.allowNavigation.isNullOrEmpty()) { "server.allowNavigation is set" }
        check(config.errorPath == null && config.startPath == null) { "a server path is set" }
        check(bridge.isDeployDisabled) { "DisableDeploy is not set (res/xml/config.xml)" }
        check(bridge.appUrl.trimEnd('/') == org.classbeat.player.policy.NavigationPolicy.APP_ORIGIN) { "the app URL is not the bundle's" }
    }

    /** Capacitor keeps its plugins in a private map; it has no public way to remove one. */
    private fun removePlugins(bridge: Bridge) {
        val field = Bridge::class.java.getDeclaredField(PLUGIN_TABLE).apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val table = field.get(bridge) as MutableMap<String, Any?>
        PluginPolicy.lockDown(table)
    }

    /** Capacitor keeps the Cordova web view (and its plugin manager) in a private field too. */
    private fun removeCordovaPlugins(bridge: Bridge) {
        val field = Bridge::class.java.getDeclaredField(CORDOVA_VIEW).apply { isAccessible = true }
        val manager = (field.get(bridge) as CordovaWebView).pluginManager
        PluginPolicy.checkCordova(manager.pluginEntries.map { it.service })
        manager.setPluginEntries(emptyList())
        check(manager.pluginEntries.isEmpty()) { "Cordova plugins left: ${manager.pluginEntries.map { it.service }}" }
    }

    /** The name of Bridge's Cordova web view field in Capacitor 8.6.0; CorePluginsTest checks its type. */
    const val CORDOVA_VIEW = "cordovaWebView"

    /** The name of Bridge's plugin table in Capacitor 8.6.0; CorePluginsTest checks it is a Map. */
    const val PLUGIN_TABLE = "plugins"

    @SuppressLint("SetJavaScriptEnabled")
    private fun harden(s: WebSettings) {
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setGeolocationEnabled(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportMultipleWindows(false)
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.blockNetworkLoads = true
        s.safeBrowsingEnabled = true
    }

    private fun lockServiceWorkers() {
        val controller = ServiceWorkerController.getInstance()
        controller.serviceWorkerWebSettings.apply {
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
        }
        controller.setServiceWorkerClient(
            object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse = LockedWebViewClient.refused()
            },
        )
    }
}
