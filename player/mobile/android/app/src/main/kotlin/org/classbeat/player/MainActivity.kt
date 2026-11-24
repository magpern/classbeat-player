package org.classbeat.player

import com.getcapacitor.BridgeActivity

/**
 * The app's one activity: Capacitor's bridge with the bundled room screen, locked down before
 * its first page commits. BridgeActivity.onCreate builds the bridge in load(), which also issues
 * the first page load; the lockdown runs right after, on the same main thread, so no script of
 * the page runs before it (the web view runs the page on this thread once onCreate returns).
 */
class MainActivity : BridgeActivity() {
    override fun load() {
        super.load()
        BridgeLockdown.apply(bridge, BuildConfig.DEBUG)
    }
}
