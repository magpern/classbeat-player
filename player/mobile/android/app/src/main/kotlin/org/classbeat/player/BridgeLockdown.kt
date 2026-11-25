package org.classbeat.player

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
import org.apache.cordova.PluginManager
import org.classbeat.player.policy.PluginPolicy

/**
 * Locks a freshly built Capacitor bridge (issue #627). Every step fails closed: anything the shell
 * does not recognise stops the app rather than run with it.
 *
 * - Every plugin is removed from the bridge's table and from its Cordova plugin manager
 *   (PluginPolicy), so the page can call none. The two mode plugins are kept aside, and
 *   ModeController puts the current mode's back (issue #630).
 * - The two script interfaces Capacitor's cookie and HTTP plugins added are removed, and the
 *   cookie plugin's process-wide cookie handler is taken back.
 * - Capacitor's web view and chrome clients are replaced with locked ones: the bundle only, no
 *   permission ever granted, links out to the system browser.
 * - Web view settings: no file or content access, no geolocation, no windows, no mixed content,
 *   no network loads; service workers get nothing; remote debugging only in a debug build.
 * - Then the first page is stopped. The mode holder loads its mode's start page, which commits
 *   with all of the above in place (ModeController).
 */
object BridgeLockdown {
    /** The interfaces CapacitorCookies and CapacitorHttp add when they load; `androidBridge` stays (it carries no plugin now). */
    val REMOVED_INTERFACES: List<String> = listOf("CapacitorCookiesAndroidInterface", "CapacitorHttpAndroidInterface")

    /** The bridge's plugin table, now empty, and the mode plugins taken off it, for ModeController. */
    class Locked(val table: MutableMap<String, Any?>, val kept: Map<String, Any?>)

    fun apply(bridge: Bridge, debug: Boolean, gate: PageGate): Locked {
        checkConfig(bridge)
        val locked = removePlugins(bridge)
        removeCordovaPlugins(bridge)
        val webView = bridge.webView
        REMOVED_INTERFACES.forEach(webView::removeJavascriptInterface)
        if (CookieHandler.getDefault() is CapacitorCookieManager) CookieHandler.setDefault(null)
        harden(webView.settings)
        lockServiceWorkers()
        WebView.setWebContentsDebuggingEnabled(debug)
        bridge.setWebViewClient(LockedWebViewClient(bridge, webView.context, gate))
        webView.webChromeClient = LockedChromeClient()
        webView.stopLoading()
        return locked
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
    private fun removePlugins(bridge: Bridge): Locked {
        val field = Bridge::class.java.getDeclaredField(PLUGIN_TABLE).apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val table = field.get(bridge) as MutableMap<String, Any?>
        return Locked(table, PluginPolicy.lockDown(table))
    }

    /** Capacitor keeps the Cordova web view (and its plugin manager) in a private field too. */
    private fun removeCordovaPlugins(bridge: Bridge) {
        val field = Bridge::class.java.getDeclaredField(CORDOVA_VIEW).apply { isAccessible = true }
        val manager = (field.get(bridge) as CordovaWebView).pluginManager
        val services = manager.pluginEntries.map { it.service }
        PluginPolicy.checkCordova(services)
        manager.setPluginEntries(emptyList())
        // exec() looks in the loaded plugins (pluginMap) before the entries, so both must be empty.
        val loaded = PluginManager::class.java.getDeclaredField(CORDOVA_LOADED).apply { isAccessible = true }
        val left = (loaded.get(manager) as Map<*, *>).keys + manager.pluginEntries.map { it.service }
        check(left.isEmpty()) { "Cordova plugins left: $left" }
        check(services.none { manager.getPlugin(it) != null }) { "a Cordova plugin is still reachable" }
    }

    /** The name of PluginManager's loaded-plugin map in Cordova 14.0.1; CorePluginsTest checks it. */
    const val CORDOVA_LOADED = "pluginMap"

    /** The name of Bridge's Cordova web view field in Capacitor 8.6.0; CorePluginsTest checks its type. */
    const val CORDOVA_VIEW = "cordovaWebView"

    /** The name of Bridge's plugin table in Capacitor 8.6.0; CorePluginsTest checks it is a Map. */
    const val PLUGIN_TABLE = "plugins"

    /** The settings of every web view the app builds: also the external display's (RoomPresentation). */
    fun harden(s: WebSettings) {
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
