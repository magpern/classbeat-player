package org.classbeat.player.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginPolicyTest {
    private fun table(vararg names: String): MutableMap<String, Any> = names.associateWith { Any() }.toMutableMap()

    @Test
    fun `the locked shell keeps no plugin`() {
        assertTrue(PluginPolicy.CALLABLE.isEmpty())
        assertEquals(PluginPolicy.CORE, PluginPolicy.KNOWN)
    }

    @Test
    fun `every core plugin is removed`() {
        val t = table(*PluginPolicy.CORE.toTypedArray())
        assertEquals(PluginPolicy.CORE.sorted(), PluginPolicy.lockDown(t))
        assertTrue(t.isEmpty())
    }

    @Test
    fun `one unknown plugin stops the app and nothing is removed`() {
        for (extra in listOf("Camera", "Geolocation", "Filesystem", "CapacitorHttp2", "")) {
            val t = table(*PluginPolicy.CORE.toTypedArray(), extra)
            val e = assertThrows(PluginPolicy.UnknownPlugin::class.java) { PluginPolicy.lockDown(t) }
            assertTrue(e.message!!.contains("[$extra]"))
            assertEquals(PluginPolicy.CORE + extra, t.keys)
        }
    }

    @Test
    fun `an empty table stays empty`() {
        val t = table()
        assertEquals(emptyList<String>(), PluginPolicy.lockDown(t))
        assertTrue(t.isEmpty())
    }

    @Test
    fun `the Cordova defaults pass the check and one more name does not`() {
        PluginPolicy.checkCordova(PluginPolicy.CORDOVA_DEFAULTS)
        PluginPolicy.checkCordova(emptyList())
        for (extra in listOf("Whitelist", "File", "Device")) {
            assertThrows(PluginPolicy.UnknownPlugin::class.java) {
                PluginPolicy.checkCordova(PluginPolicy.CORDOVA_DEFAULTS + extra)
            }
        }
    }
}
