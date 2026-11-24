package org.classbeat.player.classes

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.Calls
import org.classbeat.player.backend.Json
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * [ClassCache] in files under [dir]: one canonical JSON document per class, named by its id, and the
 * cursor. The app passes its no-backup files directory, which the web view cannot reach and backups
 * leave out. Each file is written whole to a temporary name and renamed, so a write cut short leaves
 * the old file or none. A document is read back only when it is still canonical JSON whose hash is
 * the one it was stored under (its file holds the hash's bytes); anything else is deleted.
 */
class FileClassCache(private val dir: File) : ClassCache {
    private val classes = File(dir, "classes")
    private val cursorFile = File(dir, "cursor")

    override fun cursor(): Long = try {
        cursorFile.readText().toLongOrNull()?.takeIf { it >= 0 } ?: 0
    } catch (e: IOException) {
        0
    }

    override fun held(): Map<String, String> {
        val files = classes.listFiles() ?: return emptyMap()
        val out = HashMap<String, String>()
        for (f in files) {
            val id = f.name.removeSuffix(SUFFIX)
            if (!f.name.endsWith(SUFFIX) || !Calls.isClassId(id)) {
                f.delete()
                continue
            }
            val text = read(f) ?: continue
            out[id] = hashOf(text)
        }
        return out
    }

    override fun document(id: String): String? {
        if (!Calls.isClassId(id)) return null
        return read(File(classes, id + SUFFIX))
    }

    override fun put(id: String, hash: String, text: String) {
        require(Calls.isClassId(id)) { "not a class id" }
        check(hashOf(text) == hash) { "the text is not the class" }
        write(File(classes, id + SUFFIX), text)
    }

    override fun remove(id: String) {
        val f = File(classes, id + SUFFIX)
        if (f.exists() && !f.delete()) throw IOException("a class was not removed")
    }

    override fun setCursor(cursor: Long) {
        require(cursor >= 0) { "cursor out of range" }
        write(cursorFile, cursor.toString())
    }

    override fun clear() {
        classes.deleteRecursively()
        cursorFile.delete()
        if (classes.exists() || cursorFile.exists()) throw IOException("the classes were not cleared")
    }

    /** The file's text if it is still a canonical document; a file that is not is deleted. */
    private fun read(f: File): String? {
        val text = try {
            f.readText()
        } catch (e: IOException) {
            return null
        }
        val canonical = Json.tryParse(text).getOrNull()?.let { runCatching { CanonicalJson.write(it) }.getOrNull() }
        if (canonical != text) {
            f.delete()
            return null
        }
        return text
    }

    private fun write(f: File, text: String) {
        f.parentFile?.let { if (!it.isDirectory && !it.mkdirs()) throw IOException("no directory") }
        val tmp = File(f.parentFile, f.name + ".tmp")
        FileOutputStream(tmp).use {
            it.write(text.toByteArray(Charsets.UTF_8))
            it.fd.sync()
        }
        if (!tmp.renameTo(f)) {
            tmp.delete()
            throw IOException("not written")
        }
    }

    private companion object {
        const val SUFFIX = ".json"

        /** The content hash of canonical text: sha256 over its UTF-8 bytes, as [CanonicalJson.contentHash]. */
        fun hashOf(text: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            return "sha256:" + digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }
    }
}
