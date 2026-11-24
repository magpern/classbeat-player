package org.classbeat.player

import com.getcapacitor.Bridge
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.apache.cordova.CordovaWebView
import org.apache.cordova.PluginManager
import org.classbeat.player.policy.PluginPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ties the plugin allowlist to the Capacitor and Cordova code the app is built with (issue #627):
 * if an update adds a plugin, a script interface or a default Cordova entry, a test here fails
 * before the lockdown meets it on a device.
 */
class CorePluginsTest {
    private val pkg = File(System.getProperty("classbeat.capacitorPackage") ?: error("run through Gradle"))
    private val src = File(pkg, "capacitor/src/main/java")
    private val bridgeJava = File(src, "com/getcapacitor/Bridge.java").readText()
    private val javaFiles = src.walkTopDown().filter { it.isFile && it.extension == "java" }.toList()

    private fun pluginName(className: String): String {
        val c = Class.forName(className, false, javaClass.classLoader)
        val a = c.getAnnotation(CapacitorPlugin::class.java) ?: error("$className has no @CapacitorPlugin")
        return a.name.ifEmpty { c.simpleName }
    }

    @Test
    fun `the Capacitor package is the pinned 8_6_0`() {
        assertTrue(Regex("\"version\":\\s*\"8\\.6\\.0\"").containsMatchIn(File(pkg, "package.json").readText()))
    }

    @Test
    fun `the plugins every bridge registers are exactly CORE`() {
        val body = bridgeJava.substringAfter("private void registerAllPlugins()").substringBefore("\n    }\n")
        val classes = Regex("""registerPlugin\(([\w.]+)\.class\)""").findAll(body).map { it.groupValues[1] }.toList()
        assertEquals(PluginPolicy.CORE, classes.map(::pluginName).toSet())
        // The other plugins it registers come from capacitor.plugins.json, which ships empty.
        assertTrue(body.contains("this.initialPlugins") && body.contains("pluginInstances"))
        val shipped = File("src/main/assets/capacitor.plugins.json").readText().trim()
        assertEquals("[]", shipped)
    }

    @Test
    fun `every plugin class in Capacitor is a known name`() {
        val declared = javaFiles
            .filter { f -> Regex("""^@CapacitorPlugin\b""", RegexOption.MULTILINE).containsMatchIn(f.readText()) }
            .map { f -> "com.getcapacitor." + f.relativeTo(File(src, "com/getcapacitor")).path.removeSuffix(".java").replace(File.separatorChar, '.') }
        assertTrue(declared.isNotEmpty())
        val unknown = declared.map(::pluginName).filterNot { it in PluginPolicy.KNOWN }
        assertEquals(emptyList<String>(), unknown)
    }

    @Test
    fun `every script interface Capacitor adds is removed, except the bridge's own`() {
        val names = javaFiles.flatMap { f ->
            Regex("""addJavascriptInterface\(\s*\w+\s*,\s*"([^"]+)"\s*\)""").findAll(f.readText()).map { it.groupValues[1] }.toList()
        }.toSet()
        val calls = javaFiles.sumOf { f -> Regex("""addJavascriptInterface\(""").findAll(f.readText()).count() }
        assertEquals("every call names its interface with a literal", calls, javaFiles.sumOf { f ->
            Regex("""addJavascriptInterface\(\s*\w+\s*,\s*"[^"]+"\s*\)""").findAll(f.readText()).count()
        })
        assertEquals(BridgeLockdown.REMOVED_INTERFACES.toSet() + "androidBridge", names)
    }

    @Test
    fun `the fields the lockdown reads exist with the expected types`() {
        val plugins = Bridge::class.java.getDeclaredField(BridgeLockdown.PLUGIN_TABLE)
        assertTrue(Map::class.java.isAssignableFrom(plugins.type))
        val cordova = Bridge::class.java.getDeclaredField(BridgeLockdown.CORDOVA_VIEW)
        assertEquals(CordovaWebView::class.java, cordova.type)
        val loaded = PluginManager::class.java.getDeclaredField(BridgeLockdown.CORDOVA_LOADED)
        assertTrue(Map::class.java.isAssignableFrom(loaded.type))
        val maps = PluginManager::class.java.declaredFields.filter { Map::class.java.isAssignableFrom(it.type) }.map { it.name }
        assertEquals("every plugin map the lockdown must empty", setOf("pluginMap", "entryMap"), maps.toSet())
    }

    @Test
    fun `Cordova is the pinned 14_0_1 and its parser adds only the known defaults`() {
        val gradle = File(pkg, "capacitor/build.gradle").readText()
        assertTrue(gradle.contains(": '14.0.1'"))
        val parser = javaClass.classLoader!!.getResourceAsStream("org/apache/cordova/ConfigXmlParser.class")!!.readBytes()
            .toString(Charsets.ISO_8859_1)
        val defaults = Regex("""Cordova\w*Plugin""").findAll(parser).map { it.value }.toSet()
        assertEquals(PluginPolicy.CORDOVA_DEFAULTS, defaults)
    }

    @Test
    fun `config xml adds no Cordova plugin and disables deploy`() {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/res/xml/config.xml"))
        assertEquals(0, doc.getElementsByTagName("feature").length)
        val prefs = doc.getElementsByTagName("preference")
        val map = (0 until prefs.length).associate { i ->
            val e = prefs.item(i) as org.w3c.dom.Element
            e.getAttribute("name") to e.getAttribute("value")
        }
        assertEquals(mapOf("DisableDeploy" to "true"), map)
    }
}
