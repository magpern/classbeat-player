package org.classbeat.player.classes

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.fake.FakeClasses.doc
import org.classbeat.player.fake.FakeClasses.hash
import org.classbeat.player.fake.FakeClasses.id
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class FileClassCacheTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val d = doc("Alpha")
    private val text = CanonicalJson.write(d)

    @Test
    fun `keeps a class and the cursor across instances`() {
        FileClassCache(tmp.root).apply {
            put(id(1), hash(d), text)
            setCursor(42)
        }
        val again = FileClassCache(tmp.root)
        assertEquals(mapOf(id(1) to hash(d)), again.held())
        assertEquals(text, again.document(id(1)))
        assertEquals(42L, again.cursor())
        assertFalse(File(tmp.root, "classes").listFiles()!!.any { it.name.endsWith(".tmp") })
    }

    @Test
    fun `refuses a text that is not the class`() {
        val c = FileClassCache(tmp.root)
        assertThrows(IllegalStateException::class.java) { c.put(id(1), hash(doc("Bravo")), text) }
        assertThrows(IllegalArgumentException::class.java) { c.put("../x", hash(d), text) }
        assertTrue(c.held().isEmpty())
    }

    @Test
    fun `a changed or stray file is deleted, never read`() {
        val c = FileClassCache(tmp.root)
        c.put(id(1), hash(d), text)
        val f = File(tmp.root, "classes/${id(1)}.json")
        f.writeText("{ \"class\": 1 }")
        File(tmp.root, "classes/stray.txt").writeText("x")
        assertNull(c.document(id(1)))
        assertFalse(f.exists())
        assertTrue(c.held().isEmpty())
        assertFalse(File(tmp.root, "classes/stray.txt").exists())
    }

    @Test
    fun `clear deletes every class and the cursor`() {
        val c = FileClassCache(tmp.root)
        c.put(id(1), hash(d), text)
        c.setCursor(3)
        c.clear()
        assertTrue(c.held().isEmpty())
        assertEquals(0L, c.cursor())
        c.remove(id(2))
    }
}
