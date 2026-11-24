package org.classbeat.player.classes

import java.text.Collator
import java.util.Locale

/**
 * The instructor's class list rows, as the desktop's `core/sync/class-list.ts` builds them: one per
 * cached class whose document has the shape, sorted by title A to Z without regard to case or
 * accents, equal titles by id; never by time, use or popularity (plan rules 11 and 13). Pure.
 */
object ClassRows {
    data class Row(val id: String, val title: String, val lengthMs: Double, val sport: String, val source: String, val songs: Int)

    private val SPORTS = setOf("cycling", "running")
    private val SOURCES = setOf("spotify", "swedebeat", "none")

    /** The displayed fields of a document, or null when it has not the shape. */
    fun row(id: String, doc: Any?): Row? {
        val d = doc as? Map<*, *> ?: return null
        val cls = d["class"] as? Map<*, *> ?: return null
        val music = d["music"] as? Map<*, *> ?: return null
        val songs = d["songs"] as? List<*> ?: return null
        val title = cls["title"] as? String ?: return null
        val length = cls["length_ms"] as? Double ?: return null
        val sport = cls["sport"] as? String ?: return null
        val source = music["source"] as? String ?: return null
        if (!length.isFinite() || length < 0 || sport !in SPORTS || source !in SOURCES) return null
        return Row(id, title, length, sport, source, songs.size)
    }

    fun sorted(rows: List<Row>): List<Row> {
        val titles = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.PRIMARY }
        return rows.sortedWith { a, b -> titles.compare(a.title, b.title).takeIf { it != 0 } ?: a.id.compareTo(b.id) }
    }
}
