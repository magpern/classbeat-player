package org.classbeat.player.fake

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer
import org.classbeat.player.classes.ClassCache

/** Class documents and the player API's answers about them, as the fake backend sends them. */
object FakeClasses {
    fun id(n: Int) = "00000000-0000-4000-8000-%012d".format(n)

    fun doc(title: String, lengthMs: Double = 2_700_000.0, songs: Int = 2, sport: String = "cycling", source: String = "none"): Map<String, Any?> = mapOf(
        "class" to mapOf("title" to title, "length_ms" to lengthMs, "sport" to sport),
        "music" to mapOf("source" to source),
        "songs" to List(songs) { mapOf("n" to it.toDouble()) },
    )

    fun hash(doc: Any?) = CanonicalJson.contentHash(doc)

    fun change(id: String, position: Long, doc: Any? = null) = mapOf(
        "class_id" to id,
        "source" to "classbeat",
        "source_class_id" to "c$position",
        "publication_number" to 1.0,
        "removed" to (doc == null),
        "content_hash" to doc?.let(::hash),
        "published_at" to "2026-11-01T10:00:00Z",
        "position" to position.toDouble(),
    )

    fun page(cursor: Long, more: Boolean, vararg changes: Map<String, Any?>) =
        HttpAnswer.Http(200, mapOf("changes" to changes.toList(), "cursor" to cursor.toDouble(), "more" to more), null)

    fun classAnswer(id: String, doc: Any?, hash: String = hash(doc)) = HttpAnswer.Http(
        200,
        mapOf(
            "class_id" to id,
            "source" to "classbeat",
            "source_class_id" to "c",
            "publication_number" to 1.0,
            "content_hash" to hash,
            "position" to 1.0,
            "document" to doc,
        ),
        null,
    )
}

/** The class cache in memory; [fails] makes every write throw, as a full disk would. */
class MemoryCache : ClassCache {
    val docs = linkedMapOf<String, Pair<String, String>>()
    var position = 0L
    var fails = false

    override fun cursor() = position

    override fun held() = docs.mapValues { it.value.first }

    override fun document(id: String) = docs[id]?.second

    override fun put(id: String, hash: String, text: String) {
        if (fails) error("disk full")
        docs[id] = hash to text
    }

    override fun remove(id: String) {
        if (fails) error("disk full")
        docs.remove(id)
    }

    override fun setCursor(cursor: Long) {
        if (fails) error("disk full")
        position = cursor
    }

    override fun clear() {
        docs.clear()
        position = 0
    }
}
