package org.classbeat.player

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.classbeat.player.policy.PermissionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * Reads the merged manifest of the variant under test (app/build.gradle.kts passes its path), so
 * whatever a library adds is checked too (issue #627).
 */
class ManifestTest {
    private val android = "http://schemas.android.com/apk/res/android"
    private val variant = System.getProperty("classbeat.variant") ?: error("run through Gradle")
    private val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        .newDocumentBuilder()
        .parse(File(System.getProperty("classbeat.mergedManifest") ?: error("run through Gradle")))

    private fun elements(tag: String): List<Element> =
        doc.getElementsByTagName(tag).let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }

    private fun Element.attr(name: String): String? = getAttributeNodeNS(android, name)?.value

    private val app = elements("application").single()

    @Test
    fun `the merged manifest asks for no permission outside the allowlist`() {
        val asked = (elements("uses-permission") + elements("uses-permission-sdk-23")).map { it.attr("name")!! }
        assertEquals(emptyList<String>(), PermissionPolicy.violations(asked, BuildConfig.APPLICATION_ID))
    }

    @Test
    fun `one extra permission is caught, and the never list holds whatever the allowlist says`() {
        val pkg = BuildConfig.APPLICATION_ID
        val ok = PermissionPolicy.allowed(pkg).toList()
        for (extra in listOf("android.permission.INTERNET", "android.permission.BLUETOOTH_CONNECT", "com.example.ANY") + PermissionPolicy.NEVER) {
            assertEquals(extra, listOf(extra), PermissionPolicy.violations(ok + extra, pkg))
        }
        assertEquals(listOf("android.permission.FOO_LOCATION"), PermissionPolicy.violations(listOf("android.permission.FOO_LOCATION"), pkg))
        assertTrue(PermissionPolicy.allowed(pkg).none { it in PermissionPolicy.NEVER || "LOCATION" in it })
    }

    @Test
    fun `backup is off and cleartext is refused`() {
        assertEquals("false", app.attr("allowBackup"))
        assertEquals("false", app.attr("fullBackupContent"))
        assertEquals("@xml/data_extraction_rules", app.attr("dataExtractionRules"))
        assertEquals("false", app.attr("usesCleartextTraffic"))
        assertEquals("@xml/network_security_config", app.attr("networkSecurityConfig"))
    }

    @Test
    fun `only a debug build is debuggable`() {
        val debuggable = app.attr("debuggable") == "true"
        when (variant) {
            "debug" -> assertTrue(debuggable && BuildConfig.DEBUG)
            "release" -> assertTrue(!debuggable && !BuildConfig.DEBUG)
            else -> error("unknown variant $variant")
        }
    }

    @Test
    fun `only the launcher activity and the DUMP-guarded profile receiver are exported`() {
        val exported = listOf("activity", "activity-alias", "service", "receiver", "provider")
            .flatMap(::elements)
            .filter { it.attr("exported") == "true" }
            .associate { it.attr("name")!! to it.attr("permission") }
        assertEquals(
            mapOf(
                "org.classbeat.player.MainActivity" to null,
                "androidx.profileinstaller.ProfileInstallReceiver" to "android.permission.DUMP",
            ),
            exported,
        )
    }
}
