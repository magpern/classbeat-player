package org.classbeat.player.classes

import org.classbeat.player.backend.CanonicalJson
import org.classbeat.player.backend.HttpAnswer

/**
 * What the player API answers to the list and the class calls (schema/player-api/v1; ADR 0002 §6
 * and §7), read strictly, as the desktop's `core/sync/answers.ts` reads them. Pure. Anything not
 * exactly an expected answer is "unexpected": the app never guesses, and never deletes on it.
 */
object ClassAnswers {
    /** A class the account holds now, or a removal marker. No content. */
    data class Change(val id: String, val removed: Boolean, val hash: String?, val position: Long)

    /** Why an answer is not a result. Only [GONE] ever leads to deleting anything. */
    enum class Refusal { OFFLINE, RETRY, GONE, EXPIRED, UNEXPECTED }

    sealed class ListResult {
        data class Page(val changes: List<Change>, val cursor: Long, val more: Boolean) : ListResult()

        object Resync : ListResult()

        data class Refused(val why: Refusal) : ListResult()
    }

    sealed class FetchResult {
        /** The document, with its hash checked, as canonical JSON text. */
        class Class(val hash: String, val text: String) : FetchResult()

        object NotFound : FetchResult()

        /** A JSON answer that is not a class to keep: that class is skipped, its cached copy kept. */
        object Unusable : FetchResult()

        data class Refused(val why: Refusal) : FetchResult()
    }

    const val PAGE_MAX = 500
    private const val MAX_SOURCE = 10_000
    private const val MAX_SAFE = 9_007_199_254_740_991.0
    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val HASH = Regex("^sha256:[0-9a-f]{64}$")
    private val STAMP = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$")
    private val CHANGE_KEYS = setOf("class_id", "source", "source_class_id", "publication_number", "removed", "content_hash", "published_at", "position")
    private val PAGE_KEYS = setOf("changes", "cursor", "more")
    private val CLASS_KEYS = setOf("class_id", "source", "source_class_id", "publication_number", "content_hash", "position", "document")

    private fun only(v: Any?, keys: Set<String>): Map<*, *>? = (v as? Map<*, *>)?.takeIf { it.keys == keys }

    /** A JSON integer held exactly; larger than 2^53 is refused, never rounded. */
    private fun whole(v: Any?, min: Long): Long? {
        val d = v as? Double ?: return null
        return if (d == Math.floor(d) && d >= min && d <= MAX_SAFE) d.toLong() else null
    }

    private fun text(v: Any?, max: Int) = v is String && v.length in 1..max

    fun refusal(a: HttpAnswer): Refusal {
        if (a !is HttpAnswer.Http) return Refusal.OFFLINE
        if (a.status == 429 || a.status >= 500) return Refusal.RETRY
        val code = (a.body as? Map<*, *>)?.get("error")
        if (a.status == 401 && (code == "token_revoked" || code == "token_unknown")) return Refusal.GONE
        if (a.status == 401 && code == "token_expired") return Refusal.EXPIRED
        return Refusal.UNEXPECTED
    }

    private fun change(v: Any?): Change? {
        val o = only(v, CHANGE_KEYS) ?: return null
        val id = o["class_id"] as? String ?: return null
        val removed = o["removed"] as? Boolean ?: return null
        val position = whole(o["position"], 1) ?: return null
        if (!UUID.matches(id) || whole(o["publication_number"], 1) == null) return null
        if (!text(o["source"], MAX_SOURCE) || !text(o["source_class_id"], 100)) return null
        if ((o["published_at"] as? String)?.let(STAMP::matches) != true) return null
        val hash = o["content_hash"]
        // A removal has no hash; a class always has one.
        if (if (removed) hash != null else hash !is String || !HASH.matches(hash)) return null
        return Change(id, removed, hash as String?, position)
    }

    /**
     * `GET /api/player/changes?after=<after>`: one page in sync order. Places only grow, lie above
     * [after] and at or below the page's cursor, a class is listed once, and a page with more to
     * follow moves the cursor.
     */
    fun parseChanges(a: HttpAnswer, after: Long): ListResult {
        if (a is HttpAnswer.Http && a.status == 409) {
            val o = only(a.body, setOf("error", "cursor"))
            if (o != null && o["error"] == "resync_required" && whole(o["cursor"], 0) != null) return ListResult.Resync
        }
        if (a !is HttpAnswer.Http || a.status != 200) return ListResult.Refused(refusal(a))
        val unexpected = ListResult.Refused(Refusal.UNEXPECTED)
        val body = only(a.body, PAGE_KEYS) ?: return unexpected
        val list = body["changes"] as? List<*> ?: return unexpected
        val cursor = whole(body["cursor"], after) ?: return unexpected
        val more = body["more"] as? Boolean ?: return unexpected
        if (list.size > PAGE_MAX || (more && cursor == after)) return unexpected
        val changes = ArrayList<Change>(list.size)
        val ids = HashSet<String>()
        var last = after
        for (raw in list) {
            val c = change(raw) ?: return unexpected
            if (c.position <= last || c.position > cursor || !ids.add(c.id)) return unexpected
            changes += c
            last = c.position
        }
        return ListResult.Page(changes, cursor, more)
    }

    /**
     * `GET /api/player/classes/{id}`: kept only when the document's own content hash (ADR 0003:
     * sha256 over RFC 8785 JSON) is the one the answer states. Checked here, in native code, so the
     * web view never gets a class whose hash was not checked.
     */
    fun parseClass(a: HttpAnswer, id: String): FetchResult {
        if (a is HttpAnswer.Http && a.status == 404 && only(a.body, setOf("error"))?.get("error") == "not_found") return FetchResult.NotFound
        if (a !is HttpAnswer.Http || a.status != 200) return FetchResult.Refused(refusal(a))
        if (a.body !is Map<*, *>) return FetchResult.Refused(Refusal.UNEXPECTED)
        val body = only(a.body, CLASS_KEYS) ?: return FetchResult.Unusable
        val hash = body["content_hash"] as? String
        val document = body["document"] as? Map<*, *>
        if (body["class_id"] != id || document == null || hash == null || !HASH.matches(hash)) return FetchResult.Unusable
        if (whole(body["position"], 1) == null || whole(body["publication_number"], 1) == null) return FetchResult.Unusable
        if (!text(body["source"], MAX_SOURCE) || !text(body["source_class_id"], 100)) return FetchResult.Unusable
        return try {
            if (CanonicalJson.contentHash(document) == hash) FetchResult.Class(hash, CanonicalJson.write(document)) else FetchResult.Unusable
        } catch (e: CanonicalJson.Unsupported) {
            FetchResult.Unusable
        }
    }
}
