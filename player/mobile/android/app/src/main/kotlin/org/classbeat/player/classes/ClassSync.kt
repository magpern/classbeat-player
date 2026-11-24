package org.classbeat.player.classes

import org.classbeat.player.backend.BackendTransport
import org.classbeat.player.backend.Calls
import org.classbeat.player.classes.ClassAnswers.FetchResult
import org.classbeat.player.classes.ClassAnswers.ListResult
import org.classbeat.player.classes.ClassAnswers.Refusal
import org.classbeat.player.pairing.PairingProtocol
import org.classbeat.player.pairing.PairingRecord

/**
 * The phone's copy of the account's classes, in native storage the web view cannot reach. Each
 * write is durable before it returns and throws if it could not be made.
 */
interface ClassCache {
    /** The last place synced to; 0 for none. */
    fun cursor(): Long

    /** Every class held, by id, with the content hash of its stored document. */
    fun held(): Map<String, String>

    /** The stored document, as canonical JSON text, only when it still matches its hash; else null. */
    fun document(id: String): String?

    fun put(id: String, hash: String, text: String)

    fun remove(id: String)

    fun setCursor(cursor: Long)

    /** Deletes every class and the cursor. */
    fun clear()
}

/**
 * Brings the cache up to date with the account, page by page (ADR 0002 §7), as the desktop's sync
 * does. Pure: the transport, the cache and the pairing are ports. One sync runs at a time; a sync
 * asked for while one runs gets that one's outcome. Not thread-safe: main thread only.
 *
 * The cursor moves only after a page's classes are stored, so a sync cut short repeats work and
 * never skips a class. A resync (the backend no longer has the cursor's history) walks the whole
 * list from 0 and only then removes what it did not see.
 */
class ClassSync(
    private val transport: BackendTransport,
    private val cache: ClassCache,
    /** The record to call with now; null when unpaired or expired. */
    private val credential: () -> PairingRecord?,
    /** A 401 that ends or pauses the pairing. */
    private val refused: (PairingProtocol.Refusal) -> Unit,
) {
    enum class Outcome { UP_TO_DATE, NOT_PAIRED, OFFLINE, RETRY, EXPIRED, GONE, UNEXPECTED, STORAGE }

    private var waiting: MutableList<(Outcome) -> Unit>? = null

    fun run(done: (Outcome) -> Unit) {
        waiting?.let { it += done; return }
        val record = credential() ?: return done(Outcome.NOT_PAIRED)
        waiting = mutableListOf(done)
        guarded(record) { page(record, cache.cursor(), null) }
    }

    private fun finish(outcome: Outcome) {
        val all = waiting ?: return
        waiting = null
        all.forEach { it(outcome) }
    }

    /** The pairing this sync started with is still the one held; else nothing more is written. */
    private fun current(record: PairingRecord) = credential()?.token == record.token

    /** Runs [step], turning a cache that could not be written into [Outcome.STORAGE]. */
    private fun guarded(record: PairingRecord, step: () -> Unit) {
        if (!current(record)) return finish(Outcome.NOT_PAIRED)
        try {
            step()
        } catch (e: Exception) {
            finish(Outcome.STORAGE)
        }
    }

    private fun stop(why: Refusal) {
        when (why) {
            Refusal.GONE -> refused(PairingProtocol.Refusal.GONE)
            Refusal.EXPIRED -> refused(PairingProtocol.Refusal.EXPIRED)
            else -> Unit
        }
        finish(
            when (why) {
                Refusal.OFFLINE -> Outcome.OFFLINE
                Refusal.RETRY -> Outcome.RETRY
                Refusal.GONE -> Outcome.GONE
                Refusal.EXPIRED -> Outcome.EXPIRED
                Refusal.UNEXPECTED -> Outcome.UNEXPECTED
            },
        )
    }

    /** [seen] is non-null during a resync: every class id the full walk has listed so far. */
    private fun page(record: PairingRecord, after: Long, seen: MutableSet<String>?) {
        transport.send(Calls.changes(record.origin, record.token, after)) { answer ->
            guarded(record) {
                when (val r = ClassAnswers.parseChanges(answer, after)) {
                    // A resync that asks for a resync again is not an answer to trust.
                    ListResult.Resync -> if (seen == null) page(record, 0, HashSet()) else finish(Outcome.UNEXPECTED)
                    is ListResult.Refused -> stop(r.why)
                    is ListResult.Page -> apply(record, r, r.changes.iterator(), cache.held(), seen)
                }
            }
        }
    }

    /** Applies a page's changes one by one, fetching each class whose hash changed. */
    private fun apply(record: PairingRecord, page: ListResult.Page, rest: Iterator<ClassAnswers.Change>, held: Map<String, String>, seen: MutableSet<String>?) {
        while (rest.hasNext()) {
            val c = rest.next()
            if (c.removed) {
                seen?.remove(c.id)
                cache.remove(c.id)
                continue
            }
            seen?.add(c.id)
            if (held[c.id] == c.hash) continue
            return fetch(record, c.id) { apply(record, page, rest, held, seen) }
        }
        when {
            page.more -> {
                if (seen == null) cache.setCursor(page.cursor)
                page(record, page.cursor, seen)
            }
            seen != null -> {
                cache.held().keys.filter { it !in seen }.forEach(cache::remove)
                cache.setCursor(page.cursor)
                finish(Outcome.UP_TO_DATE)
            }
            else -> {
                cache.setCursor(page.cursor)
                finish(Outcome.UP_TO_DATE)
            }
        }
    }

    private fun fetch(record: PairingRecord, id: String, next: () -> Unit) {
        transport.send(Calls.classDocument(record.origin, record.token, id)) { answer ->
            guarded(record) {
                when (val r = ClassAnswers.parseClass(answer, id)) {
                    is FetchResult.Class -> {
                        cache.put(id, r.hash, r.text)
                        next()
                    }
                    FetchResult.NotFound -> {
                        cache.remove(id)
                        next()
                    }
                    // A class the phone cannot check is skipped; a copy it already holds is kept.
                    FetchResult.Unusable -> next()
                    is FetchResult.Refused -> stop(r.why)
                }
            }
        }
    }
}
