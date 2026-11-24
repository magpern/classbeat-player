package org.classbeat.player.backend

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CanonicalJsonTest {
    /** The schema's publication examples carry the backend's own content hash of their document. */
    private fun publication(name: String): Map<*, *> {
        val file = File("../../../../schema/class-format/v1/examples/publications/valid/$name")
        assertTrue("missing vector ${file.path}", file.isFile)
        return Json.parse(file.readText()) as Map<*, *>
    }

    @Test
    fun matchesTheBackendsHashOfEveryExampleDocument() {
        for (name in listOf("document.json", "document-removed-false.json")) {
            val p = publication(name)
            assertEquals(name, p["content_hash"], CanonicalJson.contentHash(p["document"]))
        }
    }

    @Test
    fun aChangedDocumentHasAnotherHash() {
        val p = publication("document.json")
        val doc = (p["document"] as Map<*, *>).toMutableMap()
        doc["format_version"] = "1.1"
        assertNotEquals(p["content_hash"], CanonicalJson.contentHash(doc))
    }

    @Test
    fun writesNumbersAsEcmaScriptDoes() {
        // Expected values from the `canonicalize` package under Node.
        val cases = mapOf(
            1e21 to "1e+21", 1e-7 to "1e-7", 123.456 to "123.456", -0.000001 to "-0.000001",
            5e-324 to "5e-324", 1.7976931348623157e308 to "1.7976931348623157e+308",
            0.1 + 0.2 to "0.30000000000000004", 100.0 to "100", 1e20 to "100000000000000000000",
            12345678901234567890.0 to "12345678901234567000", -1.5e-10 to "-1.5e-10",
            0.000123 to "0.000123", 0.0 to "0", -0.0 to "0",
        )
        for ((x, want) in cases) assertEquals("$x", want, CanonicalJson.number(x))
    }

    @Test
    fun sortsKeysAndEscapesAsRfc8785() {
        val v = Json.parse("""{"b":"\u0001\u001f\"\\\n","a":[true,null,1.5],"é":1,"Z":{}}""")
        assertEquals("{\"Z\":{},\"a\":[true,null,1.5],\"b\":\"\\u0001\\u001f\\\"\\\\\\n\",\"é\":1}", CanonicalJson.write(v))
    }

    @Test
    fun sortsByUtf16CodeUnits() {
        // By code point U+FF61 comes before U+1F600; by UTF-16 unit 0xD83D comes before 0xFF61.
        val v = mapOf("😀" to 1.0, "｡" to 2.0)
        assertEquals("{\"😀\":1,\"｡\":2}", CanonicalJson.write(v))
    }
}
