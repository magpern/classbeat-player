package org.classbeat.player.mode

import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.classbeat.player.policy.IntentPolicy
import org.classbeat.player.policy.Mode
import org.junit.Assert.assertEquals
import org.junit.Test

/** Each mode's plugin carries its own mode's intents, by name, and no other method the page can call. */
class ModePluginsTest {
    private val plugins = mapOf(Mode.RIDER to RiderModePlugin::class.java, Mode.INSTRUCTOR to InstructorModePlugin::class.java)

    @Test
    fun `each plugin is registered under its mode's name`() {
        for ((mode, c) in plugins) assertEquals(mode.plugin, c.getAnnotation(CapacitorPlugin::class.java).name)
    }

    @Test
    fun `rider mode has no instructor intent and instructor mode has no rider intent, on the bridge too`() {
        for ((mode, c) in plugins) {
            // Every public method in the class and its parents: Capacitor reads @PluginMethod on any.
            val callable = c.methods.filter { it.isAnnotationPresent(PluginMethod::class.java) }.map { it.name }.toSet()
            assertEquals(mode.name, IntentPolicy.of(mode), callable)
        }
    }
}
