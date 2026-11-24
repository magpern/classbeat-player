package org.classbeat.player.policy

// Which Capacitor plugins may stay on the bridge (issues #627 and #630). Pure: no Android import.
//
// Capacitor 8.6.0 registers four plugins of its own in every bridge (Bridge.registerAllPlugins):
// CapacitorCookies, WebView, CapacitorHttp and SystemBars. Each is removed before the page loads,
// so a call from the page to any of them answers "not implemented". The shell registers one plugin
// per mode (issue #630): RiderMode and InstructorMode. The lockdown takes those two off the table
// as well and keeps them in native code; only the current mode's is put back (expose), so the page
// can never reach the other mode's intents.
//
// Capacitor also runs a Cordova plugin manager, which the page reaches through the bridge's
// "cordova" calls. Cordova 14.0.1's config parser always adds two entries to it (ConfigXmlParser:
// CordovaAllowListPlugin and CordovaSplashScreenPlugin); res/xml/config.xml adds none. All are
// removed too, and the shell keeps no Cordova plugin.

object PluginPolicy {
    /** Capacitor 8.6.0's own plugins, by the id the bridge registers them under. */
    val CORE: Set<String> = setOf("CapacitorCookies", "WebView", "CapacitorHttp", "SystemBars")

    /** The plugins the page may call: one per mode, never both at once. */
    val CALLABLE: Set<String> = Mode.entries.map { it.plugin }.toSet()

    /** Every name the shell knows; any other name on the bridge stops the app. */
    val KNOWN: Set<String> = CORE + CALLABLE

    /** The Cordova entries cordova-android 14.0.1 adds by itself. */
    val CORDOVA_DEFAULTS: Set<String> = setOf("CordovaAllowListPlugin", "CordovaSplashScreenPlugin")

    class UnknownPlugin(names: Collection<String>) :
        IllegalStateException("Unknown plugins on the bridge: ${names.sorted()}")

    /**
     * Empties [registered] (the bridge's plugin table, by id) and returns the mode plugins taken off
     * it, by id, for [expose]. Throws, removing nothing, if any id is unknown or a mode plugin is
     * missing.
     */
    fun <V> lockDown(registered: MutableMap<String, V>): Map<String, V> {
        val unknown = registered.keys.filterNot { it in KNOWN }
        if (unknown.isNotEmpty()) throw UnknownPlugin(unknown)
        val missing = CALLABLE.filterNot { it in registered }
        check(missing.isEmpty()) { "Mode plugins not registered: ${missing.sorted()}" }
        val kept = registered.filterKeys { it in CALLABLE }
        registered.clear()
        return kept
    }

    /**
     * Leaves on [table] the plugin [id] from [kept] and nothing else, or nothing at all when [id] is
     * null (between modes).
     */
    fun <V> expose(table: MutableMap<String, V>, kept: Map<String, V>, id: String?) {
        table.clear()
        if (id != null) {
            require(id in CALLABLE) { "not a mode plugin: $id" }
            table[id] = kept[id] ?: error("no plugin kept for $id")
        }
        check(table.keys == setOfNotNull(id)) { "Plugins left on the bridge: ${table.keys}" }
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
