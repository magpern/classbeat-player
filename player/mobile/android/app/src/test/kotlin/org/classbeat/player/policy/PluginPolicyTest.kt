package org.classbeat.player.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginPolicyTest {
    private fun table(vararg names: String): MutableMap<String, Any> = names.associateWith { Any() }.toMutableMap()

    private val all = (PluginPolicy.CORE + PluginPolicy.CALLABLE).toTypedArray()

    @Test
    fun `the page may call only the two mode plugins, and Capacitor's own never`() {
        assertEquals(setOf("RiderMode", "InstructorMode"), PluginPolicy.CALLABLE)
        assertEquals(PluginPolicy.CORE + PluginPolicy.CALLABLE, PluginPolicy.KNOWN)
        assertTrue(PluginPolicy.CORE.none { it in PluginPolicy.CALLABLE })
    }

    @Test
    fun `the lockdown empties the table and keeps only the mode plugins aside`() {
        val t = table(*all)
        val rider = t.getValue("RiderMode")
        val kept = PluginPolicy.lockDown(t)
        assertTrue(t.isEmpty())
        assertEquals(PluginPolicy.CALLABLE, kept.keys)
        assertSame(rider, kept["RiderMode"])
    }

    @Test
    fun `one unknown plugin stops the app and nothing is removed`() {
        for (extra in listOf("Camera", "Geolocation", "Filesystem", "CapacitorHttp2", "ridermode", "")) {
            val t = table(*all, extra)
            val e = assertThrows(PluginPolicy.UnknownPlugin::class.java) { PluginPolicy.lockDown(t) }
            assertTrue(e.message!!.contains("[$extra]"))
            assertEquals(PluginPolicy.KNOWN + extra, t.keys)
        }
    }

    @Test
    fun `a missing mode plugin stops the app and nothing is removed`() {
        for (missing in PluginPolicy.CALLABLE) {
            val t = table(*all.filterNot { it == missing }.toTypedArray())
            val e = assertThrows(IllegalStateException::class.java) { PluginPolicy.lockDown(t) }
            assertTrue(e.message!!.contains(missing))
            assertEquals(PluginPolicy.KNOWN - missing, t.keys)
        }
        assertThrows(IllegalStateException::class.java) { PluginPolicy.lockDown(table()) }
    }

    @Test
    fun `expose leaves exactly the one mode plugin, or none between modes`() {
        val t = table(*all)
        val kept = PluginPolicy.lockDown(t)
        for (id in PluginPolicy.CALLABLE) {
            PluginPolicy.expose(t, kept, id)
            assertEquals(setOf(id), t.keys)
            assertSame(kept[id], t[id])
        }
        PluginPolicy.expose(t, kept, null)
        assertTrue(t.isEmpty())
    }

    @Test
    fun `expose clears whatever else is on the table and refuses any other id`() {
        val t = table(*all)
        val kept = PluginPolicy.lockDown(t)
        t.putAll(table(*all))
        PluginPolicy.expose(t, kept, "RiderMode")
        assertEquals(setOf("RiderMode"), t.keys)
        for (id in PluginPolicy.CORE + "Camera") {
            assertThrows(IllegalArgumentException::class.java) { PluginPolicy.expose(t, kept, id) }
            assertTrue(t.isEmpty())
        }
        assertThrows(IllegalStateException::class.java) { PluginPolicy.expose(t, emptyMap<String, Any>(), "RiderMode") }
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
