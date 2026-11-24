package org.classbeat.player.policy

// Which Capacitor plugins may stay on the bridge (issue #627). Pure: no Android import.
//
// Capacitor 8.6.0 registers four plugins of its own in every bridge (Bridge.registerAllPlugins):
// CapacitorCookies, WebView, CapacitorHttp and SystemBars. Each is removed before the page loads,
// so a call from the page to any of them answers "not implemented". The shell registers none of
// its own yet: CALLABLE is empty, and a plugin a later issue adds goes in it by name.
//
// Capacitor also runs a Cordova plugin manager, which the page reaches through the bridge's
// "cordova" calls. Cordova 14.0.1's config parser always adds two entries to it (ConfigXmlParser:
// CordovaAllowListPlugin and CordovaSplashScreenPlugin); res/xml/config.xml adds none. All are
// removed too, and the shell keeps no Cordova plugin.

object PluginPolicy {
    /** Capacitor 8.6.0's own plugins, by the id the bridge registers them under. */
    val CORE: Set<String> = setOf("CapacitorCookies", "WebView", "CapacitorHttp", "SystemBars")

    /** The plugins the page may call. None in the locked shell. */
    val CALLABLE: Set<String> = emptySet()

    /** Every name the shell knows; any other name on the bridge stops the app. */
    val KNOWN: Set<String> = CORE + CALLABLE

    /** The Cordova entries cordova-android 14.0.1 adds by itself. */
    val CORDOVA_DEFAULTS: Set<String> = setOf("CordovaAllowListPlugin", "CordovaSplashScreenPlugin")

    class UnknownPlugin(names: Collection<String>) :
        IllegalStateException("Unknown plugins on the bridge: ${names.sorted()}")

    /**
     * Removes from [registered] (the bridge's plugin table, by id) every plugin the page may not
     * call, and returns the ids removed. Throws, removing nothing, if any id is unknown.
     */
    fun <V> lockDown(registered: MutableMap<String, V>): List<String> {
        val unknown = registered.keys.filterNot { it in KNOWN }
        if (unknown.isNotEmpty()) throw UnknownPlugin(unknown)
        val removed = registered.keys.filterNot { it in CALLABLE }.sorted()
        removed.forEach { registered.remove(it) }
        check(registered.keys.all { it in CALLABLE }) { "Plugins left on the bridge: ${registered.keys}" }
        return removed
    }

    /**
     * Checks the Cordova plugin manager's entries (by service name) before they are all removed.
     * Throws if any is not one of cordova-android's own defaults.
     */
    fun checkCordova(services: Collection<String>) {
        val unknown = services.filterNot { it in CORDOVA_DEFAULTS }
        if (unknown.isNotEmpty()) throw UnknownPlugin(unknown)
    }
}
